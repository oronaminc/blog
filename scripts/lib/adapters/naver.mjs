import { mkdir, writeFile } from 'node:fs/promises';

// 네이버 블로그 어댑터 — ⚠️ 네이버는 공식 글쓰기 API가 없고, 브라우저 자동화는
// ToS 위반 + 계정 정지 위험이 큼(docs 참고). 그래서 자동 발행 대신 "반자동 export":
// 네이버 SmartEditor 에 붙여넣기 좋은 HTML 파일을 exports/naver/ 에 뽑아준다.
// requiredEnv 없음 → 항상 enabled(파일만 쓰므로 안전, 계정 위험 0).
const OUT_DIR = new URL('../../../exports/naver/', import.meta.url);

function slug(file) {
  return file.replace(/\.md$/, '');
}

export function createNaverAdapter() {
  async function exportFile(post) {
    await mkdir(OUT_DIR, { recursive: true });
    // 이미지는 이미 jsDelivr 절대 URL(post.html) → 네이버 에디터에 그대로 표시됨
    const doc =
      `<!-- 네이버 블로그용 export. blog.naver.com 글쓰기 > SmartEditor 에서\n` +
      `     'HTML' 모드로 전환 후 아래 내용을 붙여넣거나, 본문을 복사해 붙여넣으세요.\n` +
      `     제목: ${post.title}\n` +
      `     태그: ${post.labels.join(', ')} -->\n\n` +
      `<h1>${post.title}</h1>\n${post.html}\n`;
    const path = new URL(`${slug(post.file)}.html`, OUT_DIR);
    await writeFile(path, doc);
    return path;
  }

  return {
    id: 'naver',
    label: '네이버(반자동 export)',
    kind: 'export',
    contentFormat: 'html',
    capabilities: { canonical: false, update: true, draft: true, schedule: false, manual: true },
    requiredEnv: ['NAVER_EXPORT'], // opt-in: .env 에 NAVER_EXPORT=1 일 때만 동작(파일 export)
    hashPayload: (post) => JSON.stringify({ t: post.title, l: post.labels, h: post.html }),

    async publish(post) {
      const path = await exportFile(post);
      return { remoteId: `export:${slug(post.file)}`, url: null, isDraft: post.isDraft, exportPath: path.pathname };
    },
    async update(prev, post) {
      const path = await exportFile(post);
      return { remoteId: prev.remoteId, url: null, isDraft: post.isDraft, exportPath: path.pathname };
    },
  };
}
