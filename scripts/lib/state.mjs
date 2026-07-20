import { readFile, writeFile } from 'node:fs/promises';

// posts 파일 경로 -> { postId, url, hash, isDraft } 매핑을 저장하는 상태 파일.
// 이 파일 덕분에 같은 글을 두 번 발행(중복)하지 않고, 변경 시 업데이트만 합니다.
const STATE_FILE = new URL('../../.publish-state.json', import.meta.url);

export async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export async function saveState(state) {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}
