import { apiFetch } from './http.mjs';

// Hatena Blog(일본) 어댑터 — AtomPub. Basic 인증(HATENA_ID:HATENA_API_KEY).
// 컬렉션 URI: https://blog.hatena.ne.jp/{id}/{blogId}/atom/entry
// (국가별 배포용. 일본어 번역본이 준비되면 사용)
function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function entryXml(post) {
  const cats = post.labels.map((t) => `<category term="${xmlEscape(t)}" />`).join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<entry xmlns="http://www.w3.org/2005/Atom" xmlns:app="http://www.w3.org/2007/app">
  <title>${xmlEscape(post.title)}</title>
  <content type="text/html">${xmlEscape(post.html)}</content>
  ${cats}
  <app:control><app:draft>${post.isDraft ? 'yes' : 'no'}</app:draft></app:control>
</entry>`;
}

function extractUrl(xml) {
  const m = xml.match(/<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["']/i);
  return m ? m[1] : null;
}
function extractId(xml) {
  const m = xml.match(/<id>([^<]+)<\/id>/i);
  return m ? m[1] : null;
}

export function createHatenaAdapter() {
  const id = process.env.HATENA_ID;
  const blogId = process.env.HATENA_BLOG_ID; // 예: example.hatenablog.com
  const auth = 'Basic ' + Buffer.from(`${id}:${process.env.HATENA_API_KEY}`).toString('base64');
  const headers = { Authorization: auth, 'Content-Type': 'application/atom+xml;type=entry' };
  const collection = `https://blog.hatena.ne.jp/${id}/${blogId}/atom/entry`;

  return {
    id: 'hatena',
    label: 'Hatena Blog',
    kind: 'api',
    contentFormat: 'html',
    capabilities: { canonical: false, update: true, draft: true, schedule: false },
    requiredEnv: ['HATENA_ID', 'HATENA_BLOG_ID', 'HATENA_API_KEY'],
    hashPayload: (post) => JSON.stringify({ t: post.title, l: post.labels, d: post.isDraft, h: post.html }),

    async publish(post) {
      const res = await apiFetch(collection, { method: 'POST', headers, body: entryXml(post) }, { platform: 'hatena' });
      return { remoteId: extractId(res.text), url: extractUrl(res.text), isDraft: post.isDraft };
    },

    async update(prev, post) {
      // 편집 URI: 컬렉션의 entry/{entryId}. prev.remoteId 가 edit member URI 를 담고 있으면 그대로 사용.
      const editUri = prev.editUri || `https://blog.hatena.ne.jp/${id}/${blogId}/atom/entry/${prev.remoteId}`;
      const res = await apiFetch(editUri, { method: 'PUT', headers, body: entryXml(post) }, { platform: 'hatena' });
      return { remoteId: prev.remoteId, url: extractUrl(res.text) || prev.url, isDraft: post.isDraft };
    },
  };
}
