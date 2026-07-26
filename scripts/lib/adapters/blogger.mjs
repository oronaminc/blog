import { getAccessToken, createClient } from '../blogger.mjs';
import { toRFC3339 } from '../content.mjs';

// Blogger 어댑터 — 기존 blogger.mjs 클라이언트를 어댑터 계약으로 래핑.
// 어댑터 계약: { id, kind, contentFormat, capabilities, requiredEnv, hashPayload(post), publish(post,ctx), update(prev,post,ctx) }
export function createBloggerAdapter() {
  let client = null;
  async function getClient() {
    if (client) return client;
    const at = await getAccessToken({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    });
    client = createClient(at, process.env.BLOG_ID);
    return client;
  }

  function body(post) {
    return {
      title: post.title,
      content: post.html,
      ...(post.labels.length ? { labels: post.labels } : {}),
      ...(post.publishAt && toRFC3339(post.publishAt) ? { published: toRFC3339(post.publishAt) } : {}),
    };
  }

  return {
    id: 'blogger',
    label: 'Blogger',
    kind: 'api',
    contentFormat: 'html',
    capabilities: { canonical: false, update: true, draft: true, schedule: true },
    requiredEnv: ['BLOG_ID', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
    // 이 어댑터로 발행될 페이로드의 해시(변경 감지). HTML 기반(Blogger는 HTML 저장).
    // ⚠️ 기존 v1 상태와 호환되도록 예전 buildPost 와 동일한 키 순서/이름 사용
    //    (title,labels,isDraft,html,publishAt) — 바꾸면 전 글이 '수정됨'으로 잘못 떠 재발행됨.
    hashPayload: (post) => JSON.stringify({
      title: post.title, labels: post.labels, isDraft: post.isDraft, html: post.html, publishAt: post.publishAt,
    }),

    async publish(post) {
      const api = await getClient();
      const r = await api.insert(body(post), { isDraft: post.isDraft });
      return { remoteId: r.id, url: r.url, isDraft: post.isDraft, updated: r.updated };
    },

    async update(prev, post) {
      const api = await getClient();
      const r = await api.update(prev.remoteId, body(post));
      if (prev.isDraft && !post.isDraft) await api.publish(prev.remoteId); // 초안 → 공개
      else if (!prev.isDraft && post.isDraft) await api.revert(prev.remoteId); // 공개 → 초안
      return { remoteId: prev.remoteId, url: r.url || prev.url, isDraft: post.isDraft, updated: r.updated || prev.updated };
    },
  };
}
