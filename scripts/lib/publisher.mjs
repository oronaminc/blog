import { createHash } from 'node:crypto';
import { renderMarkdown } from './render.mjs';
import { getAccessToken, createClient } from './blogger.mjs';
import { loadState, saveState } from './state.mjs';
import { listPostFiles, readPost, normalizeLabels } from './posts.mjs';

// 발행 오케스트레이션. CLI(publish.mjs)와 웹서버가 공용으로 사용.

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name} 가 없습니다. (.env 또는 GitHub Secrets 확인)`);
  return v;
}

export function missingEnv() {
  return ['BLOG_ID', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'].filter(
    (n) => !process.env[n]
  );
}

function hashOf(str) {
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}

// 프론트매터+본문 → 발행에 필요한 정규화된 값 + 내용 해시
export function buildPost(data, content) {
  const title = data.title || 'Untitled';
  const labels = normalizeLabels(data.labels);
  const isDraft = data.draft === true;
  const html = renderMarkdown(content);
  const hash = hashOf(JSON.stringify({ title, labels, isDraft, html }));
  return { title, labels, isDraft, html, hash };
}

// 액세스 토큰을 한 번만 발급해 재사용하는 클라이언트 팩토리
export function makeClientFactory() {
  let client = null;
  return async function getClient() {
    if (client) return client;
    const accessToken = await getAccessToken({
      clientId: requireEnv('GOOGLE_CLIENT_ID'),
      clientSecret: requireEnv('GOOGLE_CLIENT_SECRET'),
      refreshToken: requireEnv('GOOGLE_REFRESH_TOKEN'),
    });
    client = createClient(accessToken, requireEnv('BLOG_ID'));
    return client;
  };
}

// 각 글의 로컬↔원격 동기화 상태 계산
// status: 'local'(미발행) | 'published' | 'draft' | 'modified'(재발행 필요)
export async function getStatuses() {
  const files = await listPostFiles();
  const state = await loadState();
  const out = [];
  for (const file of files) {
    const { data, content } = await readPost(file);
    const b = buildPost(data, content);
    const prev = state[file];
    let status;
    if (!prev) status = 'local';
    else if (prev.hash === b.hash) status = b.isDraft ? 'draft' : 'published';
    else status = 'modified';
    out.push({
      file,
      title: b.title,
      labels: b.labels,
      isDraft: b.isDraft,
      date: data.date ? String(data.date) : null,
      status,
      postId: prev?.postId || null,
      url: prev?.url || null,
    });
  }
  return out;
}

// 신규/변경 글 발행. only=파일명 지정 시 그 파일만. dryRun 시 API 호출 없이 계획만.
export async function publishPosts({ dryRun = false, only = null, onLog = () => {} } = {}) {
  let files = await listPostFiles();
  if (only) files = files.filter((f) => f === only);

  const state = await loadState();
  const getClient = makeClientFactory();
  const results = [];

  for (const file of files) {
    const { data, content } = await readPost(file);
    const { title, labels, isDraft, html, hash } = buildPost(data, content);
    const prev = state[file];

    if (prev && prev.hash === hash) {
      results.push({ file, action: 'skip', title, url: prev.url, isDraft });
      onLog(`⏭  변경 없음: ${file}`);
      continue;
    }

    const postBody = { title, content: html, ...(labels.length ? { labels } : {}) };

    if (dryRun) {
      results.push({ file, action: prev ? 'update' : 'create', title, isDraft, dryRun: true });
      onLog(`🧪 [dry-run] ${prev ? '업데이트' : '신규'}: ${file} — "${title}" (draft=${isDraft})`);
      continue;
    }

    const api = await getClient();

    if (!prev) {
      const r = await api.insert(postBody, { isDraft });
      state[file] = { postId: r.id, url: r.url, hash, isDraft };
      results.push({ file, action: 'create', title, url: r.url, isDraft });
      onLog(`✅ 발행: ${file} → ${r.url || r.id}`);
    } else {
      const r = await api.update(prev.postId, postBody);
      if (prev.isDraft && !isDraft) await api.publish(prev.postId); // 초안 → 공개
      else if (!prev.isDraft && isDraft) await api.revert(prev.postId); // 공개 → 초안
      state[file] = { postId: prev.postId, url: r.url || prev.url, hash, isDraft };
      results.push({ file, action: 'update', title, url: r.url || prev.url, isDraft });
      onLog(`♻️  업데이트: ${file} → ${r.url || r.id}`);
    }
  }

  if (!dryRun) await saveState(state);
  return results;
}
