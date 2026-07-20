// ── 상태 ──────────────────────────────────────────
const state = {
  posts: [],
  current: null, // { file, data, content }
  dirty: false,
  search: '',
  labelFilter: null,
  statusFilter: null,
};

// ── API 헬퍼 ──────────────────────────────────────
async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} 오류`);
  return data;
}

const $ = (id) => document.getElementById(id);
const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

const BADGE = {
  local: '로컬만',
  draft: '초안',
  published: '발행됨',
  modified: '수정됨',
};

function toast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast ' + kind;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 4000);
}

// ── 상태/설정 로드 ────────────────────────────────
async function loadStatus() {
  try {
    const s = await api('/api/status');
    const banner = $('banner');
    if (!s.configured) {
      banner.hidden = false;
      banner.textContent = `⚠️ 인증정보 미설정: ${s.missing.join(', ')} — docs/setup.md 참고 후 서버 재시작`;
    } else if (s.authError) {
      banner.hidden = false;
      banner.textContent = `⚠️ 인증 오류: ${s.authError}`;
    } else if (s.blog) {
      const a = $('blog-name');
      a.textContent = `· ${s.blog.name} (${s.blog.posts ?? 0}편)`;
      a.href = s.blog.url;
    }
  } catch (e) {
    /* 무시 */
  }
}

// ── 글 목록 ───────────────────────────────────────
async function loadPosts() {
  state.posts = await api('/api/posts');
  renderFilters();
  renderList();
}

function renderFilters() {
  const counts = {};
  for (const p of state.posts) counts[p.status] = (counts[p.status] || 0) + 1;
  const order = ['local', 'modified', 'draft', 'published'];
  const el = $('filters');
  el.innerHTML = '';
  const all = document.createElement('span');
  all.className = 'chip' + (state.statusFilter === null ? ' active' : '');
  all.textContent = `전체 ${state.posts.length}`;
  all.onclick = () => {
    state.statusFilter = null;
    renderFilters();
    renderList();
  };
  el.appendChild(all);
  for (const s of order) {
    if (!counts[s]) continue;
    const c = document.createElement('span');
    c.className = 'chip' + (state.statusFilter === s ? ' active' : '');
    c.textContent = `${BADGE[s]} ${counts[s]}`;
    c.onclick = () => {
      state.statusFilter = state.statusFilter === s ? null : s;
      renderFilters();
      renderList();
    };
    el.appendChild(c);
  }
}

function renderList() {
  const q = state.search.toLowerCase();
  const list = $('post-list');
  list.innerHTML = '';
  const filtered = state.posts.filter((p) => {
    if (state.statusFilter && p.status !== state.statusFilter) return false;
    if (state.labelFilter && !p.labels.includes(state.labelFilter)) return false;
    if (q) {
      const hay = (p.title + ' ' + p.labels.join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (!filtered.length) {
    list.innerHTML = '<li style="padding:14px;color:var(--text-dim);font-size:13px">글이 없습니다.</li>';
    return;
  }
  for (const p of filtered) {
    const li = document.createElement('li');
    li.className = 'post-item' + (state.current?.file === p.file ? ' active' : '');
    li.innerHTML = `
      <div class="pi-title">${escapeHtml(p.title)}</div>
      <div class="pi-meta">
        <span class="badge ${p.status}">${BADGE[p.status]}</span>
        <span>${p.date || ''}</span>
      </div>`;
    li.onclick = () => openPost(p.file);
    list.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── 에디터 ────────────────────────────────────────
async function openPost(file) {
  if (state.dirty && !confirm('저장하지 않은 변경사항이 있습니다. 계속할까요?')) return;
  const p = await api('/api/posts/' + encodeURIComponent(file));
  state.current = p;
  state.dirty = false;
  $('empty-state').hidden = true;
  $('editor-inner').hidden = false;
  $('f-title').value = p.data.title || '';
  $('f-date').value = p.data.date || '';
  $('f-labels').value = Array.isArray(p.data.labels) ? p.data.labels.join(', ') : p.data.labels || '';
  $('f-draft').checked = p.data.draft === true;
  $('f-content').value = p.content || '';
  $('file-name').textContent = file;
  const meta = state.posts.find((x) => x.file === file);
  const remote = $('open-remote');
  if (meta?.url && meta.status !== 'local') {
    remote.hidden = false;
    remote.href = meta.url;
  } else remote.hidden = true;
  markDirty(false);
  updatePreview();
  renderList();
}

function collect() {
  const labels = $('f-labels').value.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    data: {
      title: $('f-title').value || '제목 없음',
      labels,
      draft: $('f-draft').checked,
      date: $('f-date').value || undefined,
    },
    content: $('f-content').value,
  };
}

function markDirty(v) {
  state.dirty = v;
  $('dirty').textContent = v ? '● 저장 안 됨' : '';
}

async function saveCurrent(silent) {
  if (!state.current) return;
  const payload = collect();
  await api('/api/posts/' + encodeURIComponent(state.current.file), { method: 'PUT', body: payload });
  state.current.data = payload.data;
  state.current.content = payload.content;
  markDirty(false);
  if (!silent) toast('저장됨 ✓', 'ok');
  await loadPosts();
}

const autosave = debounce(() => {
  if (state.dirty && state.current) saveCurrent(true);
}, 1500);

const updatePreview = debounce(async () => {
  const { html } = await api('/api/render', { body: { markdown: $('f-content').value }, method: 'POST' });
  $('preview').innerHTML = html;
}, 250);

function onEdit() {
  markDirty(true);
  updatePreview();
  autosave();
}

// ── 새 글 / 삭제 / 발행 ───────────────────────────
async function createNew() {
  const title = prompt('새 글 제목:', '제목 없음');
  if (title === null) return;
  const { file } = await api('/api/posts', { method: 'POST', body: { title, draft: true, content: '# ' + title + '\n\n' } });
  await loadPosts();
  await openPost(file);
  $('f-title').focus();
}

async function deleteCurrent() {
  if (!state.current) return;
  const meta = state.posts.find((x) => x.file === state.current.file);
  let remote = false;
  if (meta && meta.status !== 'local') {
    remote = confirm('Blogger에 발행된 글입니다.\n확인=원격에서도 삭제, 취소=로컬 파일만 삭제');
  } else if (!confirm('이 글을 삭제할까요?')) return;
  await api('/api/posts/' + encodeURIComponent(state.current.file) + (remote ? '?remote=true' : ''), { method: 'DELETE' });
  state.current = null;
  state.dirty = false;
  $('editor-inner').hidden = true;
  $('empty-state').hidden = false;
  toast('삭제됨', 'ok');
  await loadPosts();
}

async function publishOne() {
  if (!state.current) return;
  if (state.dirty) await saveCurrent(true);
  setBusy(true);
  try {
    const { results } = await api('/api/publish', { method: 'POST', body: { file: state.current.file } });
    const r = results[0];
    const map = { create: '발행 완료', update: '업데이트 완료', skip: '변경 없음' };
    toast(`${map[r?.action] || '완료'}${r?.url ? '\n' + r.url : ''}`, 'ok');
    await loadPosts();
    await refreshCurrentMeta();
  } catch (e) {
    toast('발행 실패: ' + e.message, 'err');
  } finally {
    setBusy(false);
  }
}

async function publishAll(dryRun) {
  setBusy(true);
  try {
    const { results } = await api('/api/publish', { method: 'POST', body: { dryRun } });
    const c = { create: 0, update: 0, skip: 0 };
    for (const r of results) c[r.action] = (c[r.action] || 0) + 1;
    const prefix = dryRun ? '[미리보기] ' : '';
    toast(`${prefix}신규 ${c.create}, 업데이트 ${c.update}, 스킵 ${c.skip}`, 'ok');
    if (!dryRun) await loadPosts();
  } catch (e) {
    toast('발행 실패: ' + e.message, 'err');
  } finally {
    setBusy(false);
  }
}

async function importRemote() {
  if (!confirm('Blogger의 기존 글을 로컬 마크다운으로 가져올까요?\n(이미 있는 글은 건너뜁니다)')) return;
  setBusy(true);
  try {
    const { count } = await api('/api/import', { method: 'POST' });
    toast(count ? `${count}개 글을 가져왔습니다.` : '가져올 새 글이 없습니다.', 'ok');
    await loadPosts();
  } catch (e) {
    toast('가져오기 실패: ' + e.message, 'err');
  } finally {
    setBusy(false);
  }
}

async function refreshCurrentMeta() {
  if (!state.current) return;
  const meta = state.posts.find((x) => x.file === state.current.file);
  const remote = $('open-remote');
  if (meta?.url && meta.status !== 'local') {
    remote.hidden = false;
    remote.href = meta.url;
  }
}

function setBusy(b) {
  for (const id of ['btn-publish', 'btn-publish-all', 'btn-import', 'btn-dry', 'btn-save'])
    $(id).disabled = b;
  $('status-msg').textContent = b ? '처리 중…' : '';
}

// ── 이벤트 바인딩 ─────────────────────────────────
function bind() {
  $('btn-new').onclick = createNew;
  $('btn-save').onclick = () => saveCurrent(false);
  $('btn-publish').onclick = publishOne;
  $('btn-delete').onclick = deleteCurrent;
  $('btn-publish-all').onclick = () => publishAll(false);
  $('btn-dry').onclick = () => publishAll(true);
  $('btn-import').onclick = importRemote;

  for (const id of ['f-title', 'f-date', 'f-labels', 'f-content']) $(id).addEventListener('input', onEdit);
  $('f-draft').addEventListener('change', onEdit);

  $('search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderList();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveCurrent(false);
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// ── 시작 ──────────────────────────────────────────
bind();
loadStatus();
loadPosts();
