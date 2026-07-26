// 어댑터 공용 HTTP 헬퍼.
// 재시도 규율: 403(권한/남용)은 재시도 금지 = FATAL. 429/5xx만 캡드 지수 백오프+지터.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class FatalPublishError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'FatalPublishError';
    this.status = status;
    this.fatal = true; // 디스패처가 서킷브레이커로 처리
  }
}

// jitter 있는 대기 (0~1000ms 랜덤). Math.random 불가 환경 대비 시간 기반 유사난수.
function jitter() {
  return (Date.now() % 1000);
}

export async function apiFetch(url, opts = {}, { platform = 'api', maxRetries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, opts);
    const text = await res.text();
    if (res.ok) return { status: res.status, text, json: () => (text ? JSON.parse(text) : {}) };

    // 403 = 남용/권한 차단 → 절대 재시도 안 함(FATAL). 상위에서 전체 중단.
    if (res.status === 403 || res.status === 401) {
      throw new FatalPublishError(`${platform} ${res.status}: ${text.slice(0, 300)}`, res.status);
    }
    // 429/5xx만 캡드 지수 백오프 + 지터
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (retryable && attempt < maxRetries) {
      const wait = Math.min(1000 * 2 ** attempt + jitter(), 32000);
      await sleep(wait);
      continue;
    }
    throw new Error(`${platform} ${res.status}: ${text.slice(0, 300)}`);
  }
}
