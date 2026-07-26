import { apiFetch } from './http.mjs';
import { toRFC3339 } from '../content.mjs';

// WordPress 어댑터 — 자체호스팅/워드프레스닷컴. 앱 비밀번호(Application Password) Basic 인증.
// 태그는 이름→ID 해결(없으면 생성). content 는 HTML.
export function createWordpressAdapter() {
  const base = (process.env.WP_URL || '').replace(/\/$/, '');
  const auth = 'Basic ' + Buffer.from(`${process.env.WP_USER}:${process.env.WP_APP_PASSWORD}`).toString('base64');
  const headers = { Authorization: auth, 'Content-Type': 'application/json' };
  const api = (p) => `${base}/wp-json/wp/v2${p}`;

  // 이름 → term ID (있으면 재사용, 없으면 생성). taxonomy = 'tags' | 'categories'
  async function resolveTerms(names, taxonomy) {
    const ids = [];
    for (const name of names) {
      try {
        const found = (await apiFetch(api(`/${taxonomy}?search=${encodeURIComponent(name)}`), { headers }, { platform: 'wordpress' })).json();
        const exact = Array.isArray(found) ? found.find((t) => t.name === name) : null;
        if (exact) { ids.push(exact.id); continue; }
        const created = (await apiFetch(api(`/${taxonomy}`), { method: 'POST', headers, body: JSON.stringify({ name }) }, { platform: 'wordpress' })).json();
        if (created?.id) ids.push(created.id);
      } catch { /* 실패는 무시(본문 발행 우선) */ }
    }
    return ids;
  }

  async function body(post) {
    const tagIds = post.labels.length ? await resolveTerms(post.labels, 'tags') : [];
    // 소메뉴(카테고리) → WordPress categories. "대>소" 는 마지막(소분류)만 사용.
    const catNames = (post.category || []).map((c) => c.split('>').pop().trim()).filter(Boolean);
    const catIds = catNames.length ? await resolveTerms(catNames, 'categories') : [];
    const scheduled = post.publishAt && toRFC3339(post.publishAt);
    return {
      title: post.title,
      content: post.html,
      status: post.isDraft ? 'draft' : scheduled ? 'future' : 'publish',
      ...(scheduled ? { date: toRFC3339(post.publishAt) } : {}),
      ...(tagIds.length ? { tags: tagIds } : {}),
      ...(catIds.length ? { categories: catIds } : {}),
    };
  }

  return {
    id: 'wordpress',
    label: 'WordPress',
    kind: 'api',
    contentFormat: 'html',
    capabilities: { canonical: false, update: true, draft: true, schedule: true },
    requiredEnv: ['WP_URL', 'WP_USER', 'WP_APP_PASSWORD'],
    hashPayload: (post) => JSON.stringify({ t: post.title, l: post.labels, c: post.category, d: post.isDraft, h: post.html, p: post.publishAt }),

    async publish(post) {
      const res = await apiFetch(api('/posts'), { method: 'POST', headers, body: JSON.stringify(await body(post)) }, { platform: 'wordpress' });
      const j = res.json();
      return { remoteId: String(j.id), url: j.link, isDraft: post.isDraft };
    },

    async update(prev, post) {
      const res = await apiFetch(api(`/posts/${prev.remoteId}`), { method: 'POST', headers, body: JSON.stringify(await body(post)) }, { platform: 'wordpress' });
      const j = res.json();
      return { remoteId: String(j.id), url: j.link || prev.url, isDraft: post.isDraft };
    },
  };
}
