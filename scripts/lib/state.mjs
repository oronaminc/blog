import { readFile, writeFile, rename } from 'node:fs/promises';

// 발행 상태 파일 (.publish-state.json). v2 스키마:
// {
//   version: 2,
//   posts: {
//     "<file>.md": {
//       sourceHash: "<어댑터 무관 소스 해시>",
//       targets: {
//         blogger: { remoteId, url, hash, isDraft, updated },
//         devto:   { remoteId, url, hash },
//         ...
//       }
//     }
//   }
// }
const STATE_FILE = new URL('../../.publish-state.json', import.meta.url);

// v1(flat: { "<file>": {postId,url,hash,isDraft,updated} }) → v2 자동 마이그레이션
function migrate(raw) {
  if (raw && raw.version === 2 && raw.posts) return raw;
  const v2 = { version: 2, posts: {} };
  if (raw && typeof raw === 'object') {
    for (const [file, e] of Object.entries(raw)) {
      if (file === 'version' || file === 'posts') continue;
      if (!e || typeof e !== 'object' || !e.postId) continue;
      v2.posts[file] = {
        sourceHash: e.hash || null,
        targets: {
          blogger: {
            remoteId: e.postId,
            url: e.url || null,
            hash: e.hash || null,
            isDraft: e.isDraft === true,
            updated: e.updated || null,
          },
        },
      };
    }
  }
  return v2;
}

export async function loadState() {
  try {
    return migrate(JSON.parse(await readFile(STATE_FILE, 'utf8')));
  } catch {
    return { version: 2, posts: {} };
  }
}

export async function saveState(state) {
  // 원자적 저장(temp+rename)
  const tmp = new URL('../../.publish-state.json.tmp', import.meta.url);
  await writeFile(tmp, JSON.stringify(state, null, 2) + '\n');
  await rename(tmp, STATE_FILE);
}

// ── 헬퍼 ──────────────────────────────────────────
export function getPost(state, file) {
  return state.posts[file] || null;
}

export function getTarget(state, file, adapterId) {
  return state.posts[file]?.targets?.[adapterId] || null;
}

export function setTarget(state, file, adapterId, entry) {
  if (!state.posts[file]) state.posts[file] = { sourceHash: null, targets: {} };
  if (!state.posts[file].targets) state.posts[file].targets = {};
  state.posts[file].targets[adapterId] = entry;
}

export function removeTarget(state, file, adapterId) {
  if (state.posts[file]?.targets) delete state.posts[file].targets[adapterId];
}

export function setSourceHash(state, file, hash) {
  if (!state.posts[file]) state.posts[file] = { sourceHash: null, targets: {} };
  state.posts[file].sourceHash = hash;
}

export function deletePostState(state, file) {
  delete state.posts[file];
}
