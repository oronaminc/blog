import { createHash } from 'node:crypto';
import { renderMarkdown } from './render.mjs';
import { normalizeLabels } from './posts.mjs';

// 플랫폼 중립 콘텐츠 모델. 어떤 플랫폼이든 여기서 만든 post 를 소비한다.
// (기존 publisher.mjs 에 있던 로직을 이곳으로 이동)

// 이미지 상대경로(assets/) → 공개 절대 URL(jsDelivr). 모든 플랫폼이 그대로 참조 가능.
const ASSET_BASE = (
  process.env.ASSET_BASE_URL || 'https://cdn.jsdelivr.net/gh/oronaminc/blog@main'
).replace(/\/$/, '');

export function absolutizeAssets(html) {
  return html.replace(/((?:src|href)=)(["'])(?:\.\/)?assets\//g, `$1$2${ASSET_BASE}/assets/`);
}

// 마크다운 본문의 상대 이미지 경로도 절대 URL 로 (dev.to/Hashnode 등 md 네이티브 플랫폼용)
export function absolutizeMarkdown(md) {
  return md.replace(/(!\[[^\]]*\]\()(?:\.\/)?assets\//g, `$1${ASSET_BASE}/assets/`);
}

// 본문 첫 이미지 URL 추출 (플랫폼 대표이미지/커버용)
export function firstImageUrl(html) {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

// datetime-local("2026-08-01T09:00") → RFC3339(로컬 타임존 오프셋 포함)
export function toRFC3339(local) {
  const d = new Date(local);
  if (isNaN(d)) return null;
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = p(Math.floor(Math.abs(off) / 60));
  const om = p(Math.abs(off) % 60);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${sign}${oh}:${om}`;
}

export function isFuture(v) {
  if (!v) return false;
  const d = new Date(v);
  return !isNaN(d) && d.getTime() > Date.now();
}

function hashOf(str) {
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}

// 프론트매터+본문 → 플랫폼 중립 post 모델.
// - markdown: 이미지 절대화된 원본(md 네이티브 플랫폼용)
// - html: 렌더+절대화(HTML 플랫폼용)
// - sourceHash: 어댑터 무관한 소스 변경 감지(frontmatter+원본 md 기반)
export function buildPost(file, data, rawContent) {
  const title = data.title || 'Untitled';
  const labels = normalizeLabels(data.labels);
  const isDraft = data.draft === true;
  const publishAt = data.publishAt ? String(data.publishAt) : null;
  // 소메뉴(블로그 카테고리/분류). 대>소 계층이면 "대>소" 또는 배열 지원.
  const category = data.category != null
    ? (Array.isArray(data.category) ? data.category.map(String) : [String(data.category)])
    : [];
  // 국가별 배포용(지금은 한국어만; 구조만 대비)
  const locale = data.locale || 'ko-KR';
  const country = data.country || 'KR';
  const groupId = data.groupId || file.replace(/\.md$/, '');
  const canonicalUrl = data.canonical || null;

  const markdown = absolutizeMarkdown(rawContent);
  const html = absolutizeAssets(renderMarkdown(rawContent));
  const coverImageUrl = firstImageUrl(html);
  const sourceHash = hashOf(JSON.stringify({ title, labels, isDraft, publishAt, markdown }));

  return {
    file, title, labels, isDraft, publishAt, category,
    locale, country, groupId, canonicalUrl,
    markdown, html, coverImageUrl, sourceHash,
  };
}
