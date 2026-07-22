import 'dotenv/config';
import { getAccessToken, createClient } from './lib/blogger.mjs';
import { loadState, saveState } from './lib/state.mjs';
import { listPostFiles, readPost } from './lib/posts.mjs';
import { buildPost } from './lib/publisher.mjs';

// 원격 Blogger 글과 로컬 파일을 제목으로 매칭해 .publish-state.json 을 복구한다.
// (발행 중 중단으로 상태가 유실됐을 때 중복 발행 방지용)
const at = await getAccessToken({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
});
const api = createClient(at, process.env.BLOG_ID);

const remote = await api.list({ maxResults: 200 });
const byTitle = new Map();
for (const p of remote.items || []) byTitle.set((p.title || '').trim(), p);

const state = await loadState();
const files = await listPostFiles();
let added = 0;
for (const file of files) {
  if (state[file]?.postId) continue; // 이미 추적됨
  const { data, content } = await readPost(file);
  const b = buildPost(data, content);
  const r = byTitle.get((b.title || '').trim());
  if (r) {
    state[file] = { postId: r.id, url: r.url, hash: b.hash, isDraft: r.status === 'DRAFT', updated: r.updated };
    added++;
    console.log(`↩︎ 복구: ${file} → ${r.id}`);
  }
}
await saveState(state);
console.log(`\n복구 완료: ${added}개 상태 기록 (총 추적 ${Object.keys(state).length})`);
