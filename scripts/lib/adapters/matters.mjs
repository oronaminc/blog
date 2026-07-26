import { apiFetch } from './http.mjs';

// Matters(대만/번체 중문) 어댑터 — GraphQL. putDraft → publishArticle.
// 국가별 배포용(번체 중국어 번역본 준비 시 사용). Bearer 토큰.
const ENDPOINT = 'https://server.matters.town/graphql';

async function gql(query, variables, token) {
  const res = await apiFetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-access-token': token, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  }, { platform: 'matters' });
  const j = res.json();
  if (j.errors) throw new Error('Matters GraphQL: ' + JSON.stringify(j.errors).slice(0, 200));
  return j.data;
}

export function createMattersAdapter() {
  const token = process.env.MATTERS_TOKEN;

  async function putDraft(post, draftId) {
    const data = await gql(
      `mutation($input: PutDraftInput!){ putDraft(input:$input){ id title } }`,
      { input: { ...(draftId ? { id: draftId } : {}), title: post.title, content: post.html, tags: post.labels.slice(0, 5) } },
      token
    );
    return data.putDraft.id;
  }
  async function publishDraft(draftId) {
    const data = await gql(
      `mutation($input: PublishArticleInput!){ publishArticle(input:$input){ id state } }`,
      { input: { id: draftId } },
      token
    );
    return data.publishArticle;
  }

  return {
    id: 'matters',
    label: 'Matters',
    kind: 'api',
    contentFormat: 'html',
    capabilities: { canonical: false, update: true, draft: true, schedule: false },
    requiredEnv: ['MATTERS_TOKEN'],
    hashPayload: (post) => JSON.stringify({ t: post.title, l: post.labels, d: post.isDraft, h: post.html }),

    async publish(post) {
      const draftId = await putDraft(post);
      if (post.isDraft) return { remoteId: draftId, url: null, isDraft: true, draftId };
      const pub = await publishDraft(draftId);
      return { remoteId: pub.id || draftId, url: null, isDraft: false, draftId };
    },

    async update(prev, post) {
      const draftId = await putDraft(post, prev.draftId || prev.remoteId);
      if (!post.isDraft) await publishDraft(draftId);
      return { remoteId: prev.remoteId, url: prev.url, isDraft: post.isDraft, draftId };
    },
  };
}
