import MarkdownIt from 'markdown-it';

// Blogger 는 게시글 본문을 raw HTML 로 저장하고, 블로그 테마의 CSS 를 입힙니다.
const md = new MarkdownIt({
  html: true, // 마크다운 안에 직접 쓴 HTML 허용
  linkify: true, // http... URL 자동 링크
  typographer: true,
  breaks: false,
});

export function renderMarkdown(body) {
  return md.render(body);
}
