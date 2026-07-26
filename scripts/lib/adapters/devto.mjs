import { apiFetch } from './http.mjs';

// Dev.to (Forem) 어댑터 — 마크다운 네이티브, canonical_url 로 SEO 안전한 크로스포스팅.
const API = 'https://dev.to/api/articles';

function tag(s) {
  // dev.to 태그는 영숫자만, 소문자, 공백 제거
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function createDevtoAdapter() {
  const key = process.env.DEVTO_API_KEY;
  const headers = { 'api-key': key, 'Content-Type': 'application/json' };

  function body(post, canonicalUrl) {
    const tags = post.labels.map(tag).filter(Boolean).slice(0, 4);
    return {
      article: {
        title: post.title,
        body_markdown: post.markdown,
        published: !post.isDraft,
        ...(tags.length ? { tags } : {}),
        ...(post.coverImageUrl ? { main_image: post.coverImageUrl } : {}),
        ...(canonicalUrl ? { canonical_url: canonicalUrl } : {}),
      },
    };
  }

  return {
    id: 'devto',
    label: 'Dev.to',
    kind: 'api',
    contentFormat: 'markdown',
    capabilities: { canonical: true, update: true, draft: true, schedule: false },
    requiredEnv: ['DEVTO_API_KEY'],
    hashPayload: (post) => JSON.stringify({ t: post.title, l: post.labels, d: post.isDraft, m: post.markdown, c: post.coverImageUrl }),

    async publish(post, ctx = {}) {
      const res = await apiFetch(API, { method: 'POST', headers, body: JSON.stringify(body(post, ctx.canonicalUrl)) }, { platform: 'devto' });
      const j = res.json();
      return { remoteId: String(j.id), url: j.url, isDraft: post.isDraft };
    },

    async update(prev, post, ctx = {}) {
      const res = await apiFetch(`${API}/${prev.remoteId}`, { method: 'PUT', headers, body: JSON.stringify(body(post, ctx.canonicalUrl)) }, { platform: 'devto' });
      const j = res.json();
      return { remoteId: String(j.id), url: j.url || prev.url, isDraft: post.isDraft };
    },
  };
}
