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

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function call(method, path, { query, body } = {}) {
    const url = new URL(`${API}/blogs/${blogId}${path}`);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    // Blogger 는 레이트리밋을 429 뿐 아니라 403(rateLimitExceeded) 로도 반환하므로
    // 두 경우 모두 지수 백오프로 재시도한다.
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) return res.json();

      const text = await res.text();
      const retryable =
        res.status === 429 ||
        (res.status === 403 && /rateLimitExceeded|userRateLimitExceeded/i.test(text));
      if (retryable && attempt < 4) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new Error(`Blogger API ${method} ${path} 실패 (${res.status}): ${text}`);
    }
  }

  return {
    // 신규 글 생성. isDraft=true 면 초안으로.
    insert: (post, { isDraft = false } = {}) =>
      call('POST', '/posts', { query: { isDraft }, body: post }),
    // 기존 글 수정.
    update: (postId, post) => call('PUT', `/posts/${postId}`, { body: post }),
    // 초안을 정식 발행.
    publish: (postId) => call('POST', `/posts/${postId}/publish`),
    // 공개된 글을 다시 초안으로 되돌림.
    revert: (postId) => call('POST', `/posts/${postId}/revert`),
  };
}
