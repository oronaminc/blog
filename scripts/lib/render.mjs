import MarkdownIt from 'markdown-it';

// Blogger 는 게시글 본문을 raw HTML 로 저장하고, 블로그 테마의 CSS 를 입힙니다.
const md = new MarkdownIt({
  html: true, // 마크다운 안에 직접 쓴 HTML 허용
  linkify: true, // http... URL 자동 링크
  typographer: true,
  breaks: false,
});

export function renderMarkdown(body) {
  let html = md.render(body);
  // SEO: 본문 제목이 페이지 H1(글 제목)과 충돌하지 않도록 헤딩을 한 단계 강등
  // (h1→h2, h2→h3 …). 본문에 h1 이 생기면 단일글 H1 규칙이 깨짐.
  html = html.replace(/<(\/?)h([1-5])\b/g, (_, slash, n) => `<${slash}h${Number(n) + 1}`);
  // CWV/SEO: 본문 이미지 지연 로딩
  html = html.replace(/<img /g, '<img loading="lazy" decoding="async" ');
  return html;
}
