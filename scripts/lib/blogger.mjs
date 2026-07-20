// Blogger REST API v3 얇은 클라이언트 (googleapis SDK 없이 fetch 만 사용).
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/blogger/v3';

// 리프레시 토큰 -> 단기 액세스 토큰 교환
export async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`액세스 토큰 갱신 실패 (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

export function createClient(accessToken, blogId) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  async function call(method, path, { query, body } = {}) {
    const url = new URL(`${API}/blogs/${blogId}${path}`);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`Blogger API ${method} ${path} 실패 (${res.status}): ${await res.text()}`);
    }
    return res.json();
  }

  return {
    // 신규 글 생성. isDraft=true 면 초안으로.
    insert: (post, { isDraft = false } = {}) =>
      call('POST', '/posts', { query: { isDraft }, body: post }),
    // 기존 글 수정.
    update: (postId, post) => call('PUT', `/posts/${postId}`, { body: post }),
    // 초안을 정식 발행.
    publish: (postId) => call('POST', `/posts/${postId}/publish`),
  };
}
