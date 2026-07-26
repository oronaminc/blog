import { createBloggerAdapter } from './blogger.mjs';
import { createDevtoAdapter } from './devto.mjs';
import { createWordpressAdapter } from './wordpress.mjs';

// 어댑터 레지스트리. 각 팩토리는 계약을 구현한 어댑터 객체를 반환.
// (Hatena/Matters/Naver 는 이후 단계에서 추가)
const FACTORIES = [
  createBloggerAdapter,
  createDevtoAdapter,
  createWordpressAdapter,
];

// canonical 우선순위: 소유 허브(WordPress) > Blogger. 목록의 앞쪽이 먼저 발행되어
// canonical URL 을 확보하고 나머지 플랫폼에 주입한다.
const CANONICAL_ORDER = ['wordpress', 'blogger', 'devto'];

function envSatisfied(requiredEnv) {
  return requiredEnv.every((k) => !!process.env[k]);
}

// 전체 어댑터(설정 무관)
export function allAdapters() {
  return FACTORIES.map((f) => f());
}

// requiredEnv 가 충족된(=설정된) 어댑터만
export function enabledAdapters(only = null) {
  let list = allAdapters().filter((a) => envSatisfied(a.requiredEnv));
  if (only && only.length) list = list.filter((a) => only.includes(a.id));
  // canonical 우선순위대로 정렬
  return list.sort((a, b) => {
    const ia = CANONICAL_ORDER.indexOf(a.id);
    const ib = CANONICAL_ORDER.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

// 어댑터별 설정 상태(UI/진단용)
export function adapterStatus() {
  return allAdapters().map((a) => ({
    id: a.id, label: a.label, kind: a.kind,
    configured: envSatisfied(a.requiredEnv),
    missing: a.requiredEnv.filter((k) => !process.env[k]),
    capabilities: a.capabilities,
  }));
}

// canonical 을 제공할 수 있는 첫 어댑터 id (소유 허브 우선)
export function canonicalAdapterId(adapters) {
  for (const id of CANONICAL_ORDER) {
    const a = adapters.find((x) => x.id === id);
    if (a && a.capabilities.canonical !== false) return id;
  }
  // Blogger 는 canonical 미지원이지만 URL 은 있으므로 최후 보루로 사용
  return adapters[0]?.id || null;
}
