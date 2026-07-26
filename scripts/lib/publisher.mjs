import { createHash } from 'node:crypto';
import { loadState, saveState, getTarget, setTarget, setSourceHash } from './state.mjs';
import { listPostFiles, readPost } from './posts.mjs';
import { buildPost, isFuture } from './content.mjs';
import { enabledAdapters, adapterStatus, canonicalAdapterId } from './adapters/index.mjs';

// 발행 오케스트레이션(디스패처). 파일 × 설정된 어댑터. CLI·웹서버 공용.
// 하위호환 re-export (server.mjs/reconcile.mjs 등이 참조)
export { buildPost, absolutizeAssets, toRFC3339, isFuture } from './content.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hashOf = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name} 가 없습니다.`);
  return v;
}

// 설정 안 된(=발행 불가) 상태 요약. 어댑터가 하나도 설정 안 됐으면 그 목록 반환.
export function missingEnv() {
  const st = adapterStatus();
  return st.some((a) => a.configured) ? [] : (st.find((a) => a.id === 'blogger')?.missing || ['BLOG_ID']);
}

// 각 글의 발행 상태(주 어댑터 기준) + 타겟별 요약.
// status: local | draft | published | scheduled | modified
export async function getStatuses() {
  const files = await listPostFiles();
  const state = await loadState();
  const adapters = enabledAdapters();
  const primary = adapters[0] || null;
  const out = [];
  for (const file of files) {
    const { data, content } = await readPost(file);
    const post = buildPost(file, data, content);

    // 타겟별 발행/변경 상태
    const targets = {};
    for (const a of adapters) {
      const prev = getTarget(state, file, a.id);
      const payloadHash = hashOf(a.hashPayload(post));
      targets[a.id] = {
        published: !!prev,
        upToDate: prev ? prev.hash === payloadHash : false,
        url: prev?.url || null,
      };
    }

    // 주 어댑터 기준 배지 상태
    let status = 'local';
    let url = null;
    if (primary) {
      const prev = getTarget(state, file, primary.id);
      url = prev?.url || null;
      if (!prev) status = 'local';
      else if (prev.hash === hashOf(primary.hashPayload(post))) {
        if (post.isDraft) status = 'draft';
        else if (isFuture(post.publishAt)) status = 'scheduled';
        else status = 'published';
      } else status = 'modified';
    }

    out.push({
      file, title: post.title, labels: post.labels, isDraft: post.isDraft,
      publishAt: post.publishAt, date: data.date ? String(data.date) : null,
      locale: post.locale, country: post.country,
      status, url, targets,
    });
  }
  return out;
}

// 신규/변경 글 발행. only=파일명, targets=어댑터id 배열(지정 시 그 어댑터만).
// 봇차단 재발 방지(docs/blogger-bot-block-guide.md §4·§5):
//  - 403 은 어댑터에서 FATAL(재시도0) → 여기서 circuit break + blockedUntil 영속화
//  - MAX_POSTS_PER_DAY 하루 발행 캡, 글 간 랜덤 지터 간격
export async function publishPosts({ dryRun = false, only = null, targets = null, onLog = () => {} } = {}) {
  let files = await listPostFiles();
  if (only) files = files.filter((f) => f === only);

  const adapters = enabledAdapters(targets);
  if (!adapters.length) {
    throw new Error('설정된 발행 대상이 없습니다. .env 에 어댑터 키를 넣으세요(예: DEVTO_API_KEY, WP_URL…).');
  }
  const canonId = canonicalAdapterId(adapters);
  const state = await loadState();
  const results = [];
  let circuitBroken = false;

  // ── 서킷브레이커: 이전 403 차단이 아직 유효하면 발행 자체를 막는다 ──
  if (!dryRun && state.blockedUntil && Date.now() < state.blockedUntil) {
    const mins = Math.ceil((state.blockedUntil - Date.now()) / 60000);
    throw new Error(`발행 차단 중(서킷브레이커). 이전 403 이후 쿨다운 ${mins}분 남음. docs/blogger-bot-block-guide.md 참고.`);
  }

  // ── 하루 발행 캡 & 랜덤 간격(지터) ──
  const MAX_PER_DAY = Number(process.env.MAX_POSTS_PER_DAY || 3); // 신생 블로그 기본 3
  const MIN_GAP_MS = Number(process.env.PUBLISH_MIN_GAP_MS || 45 * 60 * 1000); // 45분
  const MAX_GAP_MS = Number(process.env.PUBLISH_MAX_GAP_MS || 90 * 60 * 1000); // 90분
  const today = new Date().toISOString().slice(0, 10);
  if (!state.published || state.published.day !== today) state.published = { day: today, count: 0 };
  let publishedThisRun = 0;

  for (const file of files) {
    if (circuitBroken) break;
    // 하루 캡 도달 시 중단(dry-run 은 제외)
    if (!dryRun && state.published.count >= MAX_PER_DAY) {
      onLog(`⏸  하루 발행 상한(${MAX_PER_DAY}편) 도달 — 나머지는 내일. (MAX_POSTS_PER_DAY 로 조정)`);
      break;
    }
    const { data, content } = await readPost(file);
    const post = buildPost(file, data, content);
    const fileResult = { file, title: post.title, isDraft: post.isDraft, targets: {} };

    // canonical URL: frontmatter 우선, 없으면 canonical 어댑터의 기존 발행 URL
    let canonicalUrl = post.canonicalUrl || getTarget(state, file, canonId)?.url || null;

    for (const adapter of adapters) {
      if (circuitBroken) break;
      const prev = getTarget(state, file, adapter.id);
      const payloadHash = hashOf(adapter.hashPayload(post));

      if (prev && prev.hash === payloadHash) {
        fileResult.targets[adapter.id] = { action: 'skip', url: prev.url };
        onLog(`⏭  [${adapter.id}] 변경 없음: ${file}`);
        continue;
      }
      if (dryRun) {
        fileResult.targets[adapter.id] = { action: prev ? 'update' : 'create', dryRun: true };
        onLog(`🧪 [${adapter.id}] ${prev ? '업데이트' : '신규'}: ${file} — "${post.title}"`);
        continue;
      }

      // canonical 어댑터 자신에겐 자기 URL 을 canonical 로 주지 않음(원본이므로)
      const ctx = { canonicalUrl: adapter.id === canonId ? (post.canonicalUrl || null) : canonicalUrl };

      try {
        const res = prev ? await adapter.update(prev, post, ctx) : await adapter.publish(post, ctx);
        setTarget(state, file, adapter.id, { ...res, hash: payloadHash });
        if (adapter.id === canonId && !post.canonicalUrl && res.url) canonicalUrl = res.url;
        fileResult.targets[adapter.id] = { action: prev ? 'update' : 'create', url: res.url };
        onLog(`✅ [${adapter.id}] ${file} → ${res.url || res.remoteId}`);
        state.published.count += 1;
        publishedThisRun += 1;
        await saveState(state);
        // 글 간 랜덤 지터 간격(고정 cron 패턴 방지). 하루 캡의 마지막 글이면 생략.
        if (state.published.count < MAX_PER_DAY) {
          const gap = MIN_GAP_MS + (Date.now() % Math.max(1, MAX_GAP_MS - MIN_GAP_MS));
          onLog(`⏲  다음 발행까지 ${Math.round(gap / 60000)}분 대기(지터)…`);
          await sleep(gap);
        }
      } catch (err) {
        if (err.fatal) {
          circuitBroken = true;
          fileResult.targets[adapter.id] = { action: 'blocked', error: err.message };
          // blockedUntil 영속화: 재실행해도 쿨다운 동안 발행 안 함(재시도 폭풍 방지)
          const cooldownH = Number(process.env.BLOCK_COOLDOWN_HOURS || 24);
          state.blockedUntil = Date.now() + cooldownH * 3600 * 1000;
          onLog(`🛑 [${adapter.id}] 403 차단 — 전체 중단 + ${cooldownH}h 쿨다운 기록. ${err.message}`);
        } else {
          fileResult.targets[adapter.id] = { action: 'error', error: err.message };
          onLog(`❌ [${adapter.id}] ${file} 실패: ${err.message}`);
        }
      }
    }
    setSourceHash(state, file, post.sourceHash);
    results.push(fileResult);
  }

  if (!dryRun) await saveState(state);
  if (circuitBroken) {
    onLog('⚠️  403 차단 감지 → 발행 중단 + 쿨다운 기록. docs/blogger-bot-block-guide.md 참고(계정 본인확인 필요).');
  }
  return results;
}
