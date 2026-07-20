import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import { renderMarkdown } from './lib/render.mjs';
import { getAccessToken, createClient } from './lib/blogger.mjs';
import { loadState, saveState } from './lib/state.mjs';

const POSTS_DIR = new URL('../posts/', import.meta.url);
const DRY_RUN = process.argv.includes('--dry-run');

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name} 가 없습니다. (.env 또는 GitHub Secrets 확인)`);
  return v;
}

function hashOf(str) {
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}

async function collectPosts() {
  const entries = await readdir(POSTS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort();
}

async function main() {
  const files = await collectPosts();
  const state = await loadState();

  // 실제 발행이 필요할 때만 토큰/인증정보를 요구(dry-run 이나 변경 없으면 불필요).
  let client = null;
  async function getClient() {
    if (client) return client;
    const accessToken = await getAccessToken({
      clientId: env('GOOGLE_CLIENT_ID'),
      clientSecret: env('GOOGLE_CLIENT_SECRET'),
      refreshToken: env('GOOGLE_REFRESH_TOKEN'),
    });
    client = createClient(accessToken, env('BLOG_ID'));
    return client;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const file of files) {
    const raw = await readFile(new URL(file, POSTS_DIR), 'utf8');
    const { data, content } = matter(raw);

    const title = data.title || file.replace(/\.md$/, '');
    const labels = Array.isArray(data.labels)
      ? data.labels
      : data.labels
        ? [data.labels]
        : [];
    const isDraft = data.draft === true;
    const html = renderMarkdown(content);
    const hash = hashOf(JSON.stringify({ title, labels, isDraft, html }));

    const prev = state[file];

    if (prev && prev.hash === hash) {
      skipped++;
      console.log(`⏭  변경 없음: ${file}`);
      continue;
    }

    const postBody = { title, content: html, ...(labels.length ? { labels } : {}) };

    if (DRY_RUN) {
      console.log(`🧪 [dry-run] ${prev ? '업데이트' : '신규'}: ${file} — "${title}" (draft=${isDraft})`);
      continue;
    }

    const api = await getClient();

    if (!prev) {
      const result = await api.insert(postBody, { isDraft });
      state[file] = { postId: result.id, url: result.url, hash, isDraft };
      created++;
      console.log(`✅ 발행: ${file} → ${result.url || result.id}`);
    } else {
      const result = await api.update(prev.postId, postBody);
      // 초안 상태 전환 처리
      if (prev.isDraft && !isDraft) await api.publish(prev.postId); // 초안 → 공개
      else if (!prev.isDraft && isDraft) await api.revert(prev.postId); // 공개 → 초안
      state[file] = { postId: prev.postId, url: result.url || prev.url, hash, isDraft };
      updated++;
      console.log(`♻️  업데이트: ${file} → ${result.url || result.id}`);
    }
  }

  if (!DRY_RUN) await saveState(state);
  console.log(`\n완료 — 신규 ${created}, 업데이트 ${updated}, 스킵 ${skipped}`);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
