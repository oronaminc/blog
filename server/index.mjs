import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import TurndownService from 'turndown';

import { renderMarkdown } from '../scripts/lib/render.mjs';
import { getAccessToken, createClient } from '../scripts/lib/blogger.mjs';
import { loadState, saveState } from '../scripts/lib/state.mjs';
import {
  listPostFiles,
  readPost,
  writePost,
  deletePost,
  uniqueFilename,
  assertSafeFile,
  today,
} from '../scripts/lib/posts.mjs';
import {
  getStatuses,
  publishPosts,
  buildPost,
  missingEnv,
  requireEnv,
} from '../scripts/lib/publisher.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(join(__dirname, 'public')));

// 요청마다 새 클라이언트(토큰 발급). 소규모 로컬 앱이므로 단순하게.
async function bloggerClient() {
  const accessToken = await getAccessToken({
    clientId: requireEnv('GOOGLE_CLIENT_ID'),
    clientSecret: requireEnv('GOOGLE_CLIENT_SECRET'),
    refreshToken: requireEnv('GOOGLE_REFRESH_TOKEN'),
  });
  return createClient(accessToken, requireEnv('BLOG_ID'));
}

// 라우트 핸들러 에러를 일관되게 처리
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ── 설정/인증 상태 ─────────────────────────────
app.get(
  '/api/status',
  wrap(async (req, res) => {
    const missing = missingEnv();
    if (missing.length) {
      return res.json({ configured: false, missing, blog: null });
    }
    try {
      const api = await bloggerClient();
      const blog = await api.blogInfo();
      res.json({
        configured: true,
        missing: [],
        blog: {
          id: blog.id,
          name: blog.name,
          url: blog.url,
          posts: blog.posts?.totalItems ?? null,
        },
      });
    } catch (err) {
      res.json({ configured: true, authError: err.message, missing: [], blog: null });
    }
  })
);

// ── 글 목록 (동기화 상태 포함) ───────────────────
app.get(
  '/api/posts',
  wrap(async (req, res) => {
    res.json(await getStatuses());
  })
);

// ── 단일 글 읽기 ────────────────────────────────
app.get(
  '/api/posts/:file',
  wrap(async (req, res) => {
    const { data, content } = await readPost(req.params.file);
    res.json({ file: req.params.file, data, content });
  })
);

// ── 새 글 생성 ──────────────────────────────────
app.post(
  '/api/posts',
  wrap(async (req, res) => {
    const { title = '제목 없음', labels = [], draft = true, date, content = '' } = req.body || {};
    const d = date || today();
    const file = uniqueFilename(title, d);
    await writePost(file, { data: { title, labels, draft, date: d }, content });
    res.json({ file });
  })
);

// ── 글 저장(수정) ───────────────────────────────
app.put(
  '/api/posts/:file',
  wrap(async (req, res) => {
    const { data = {}, content = '' } = req.body || {};
    await writePost(req.params.file, { data, content });
    res.json({ file: req.params.file, ok: true });
  })
);

// ── 글 삭제 (로컬, 옵션으로 원격도) ──────────────
app.delete(
  '/api/posts/:file',
  wrap(async (req, res) => {
    const file = assertSafeFile(req.params.file);
    const alsoRemote = req.query.remote === 'true';
    if (alsoRemote) {
      const state = await loadState();
      const entry = state[file];
      if (entry?.postId) {
        try {
          const api = await bloggerClient();
          await api.remove(entry.postId);
        } catch (err) {
          console.warn('원격 삭제 실패(무시):', err.message);
        }
      }
      delete state[file];
      await saveState(state);
    }
    await deletePost(file);
    res.json({ ok: true });
  })
);

// ── 마크다운 프리뷰 렌더 ────────────────────────
app.post(
  '/api/render',
  wrap(async (req, res) => {
    const { markdown = '' } = req.body || {};
    res.json({ html: renderMarkdown(markdown) });
  })
);

// ── 발행 (단건/전체, dry-run) ───────────────────
app.post(
  '/api/publish',
  wrap(async (req, res) => {
    const { file = null, dryRun = false } = req.body || {};
    const logs = [];
    const results = await publishPosts({ only: file, dryRun, onLog: (m) => logs.push(m) });
    res.json({ results, logs });
  })
);

// ── 원격 Blogger 글 목록 ────────────────────────
app.get(
  '/api/remote',
  wrap(async (req, res) => {
    const api = await bloggerClient();
    const data = await api.list({ maxResults: 100 });
    const items = (data.items || []).map((p) => ({
      id: p.id,
      title: p.title,
      url: p.url,
      status: p.status,
      labels: p.labels || [],
      published: p.published,
      updated: p.updated,
    }));
    res.json({ items });
  })
);

// ── 원격 글을 로컬 마크다운으로 가져오기(임포트) ──
app.post(
  '/api/import',
  wrap(async (req, res) => {
    const api = await bloggerClient();
    const data = await api.list({ maxResults: 100 });
    const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    const state = await loadState();
    const existingByPostId = new Map(
      Object.entries(state).map(([f, e]) => [e.postId, f])
    );

    const imported = [];
    for (const p of data.items || []) {
      if (existingByPostId.has(p.id)) continue; // 이미 로컬에 있음
      const dateStr = (p.published || new Date().toISOString()).slice(0, 10);
      const md = td.turndown(p.content || '');
      const isDraft = p.status === 'DRAFT';
      const fmData = {
        title: p.title || '제목 없음',
        labels: p.labels || [],
        draft: isDraft,
        date: dateStr,
      };
      const file = makeFilename(p.title || 'post', dateStr);
      await writePost(file, { data: fmData, content: md });
      // 재발행 시 중복/덮어쓰기 방지: 현재 렌더 해시로 in-sync 표시
      const b = buildPost(fmData, md);
      state[file] = { postId: p.id, url: p.url, hash: b.hash, isDraft };
      imported.push({ file, title: p.title });
    }
    await saveState(state);
    res.json({ imported, count: imported.length });
  })
);

// SPA 폴백
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 4599;
// 로컬 전용 바인딩: 파일쓰기+발행 권한과 OAuth 토큰이 있으므로 LAN 에 노출하지 않는다.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n▶ 블로그 관리 UI 실행 중:  http://localhost:${PORT}\n`);
});
