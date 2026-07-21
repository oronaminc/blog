// ── 상태 ──────────────────────────────────────────
const state = {
  posts: [],
  current: null,
  dirty: false,
  search: '',
  statusFilter: null,
  labels: [],
  selection: new Set(),
  drift: new Set(),
};

const $ = (id) => document.getElementById(id);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

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

const BADGE = { local: '로컬만', draft: '초안', published: '발행됨', modified: '수정됨', scheduled: '예약됨' };

function toast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast ' + kind;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 4200);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── 상태/설정 ─────────────────────────────────────
async function loadStatus() {
  try {
    const s = await api('/api/status');
    const banner = $('banner');
    if (!s.configured) {
      banner.hidden = false;
      banner.textContent = `⚠ 인증정보 미설정: ${s.missing.join(', ')} — docs/setup.md 참고 후 서버 재시작`;
    } else if (s.authError) {
      banner.hidden = false;
      banner.textContent = `⚠ 인증 오류: ${s.authError}`;
    } else if (s.blog) {
      const a = $('blog-name');
      a.textContent = `${s.blog.name} · ${s.blog.posts ?? 0}편`;
      a.href = s.blog.url;
    }
  } catch {}
}

async function loadLabels() {
  try { state.labels = await api('/api/labels'); } catch {}
}

// ── 목록 ──────────────────────────────────────────
async function loadPosts() {
  state.posts = await api('/api/posts');
  renderFilters();
  renderList();
}

function renderFilters() {
  const counts = {};
  for (const p of state.posts) counts[p.status] = (counts[p.status] || 0) + 1;
  const el = $('filters');
  el.innerHTML = '';
  const mk = (key, label, n, active) => {
    const c = document.createElement('span');
    c.className = 'chip' + (active ? ' active' : '');
    c.textContent = n == null ? label : `${label} ${n}`;
    c.onclick = () => { state.statusFilter = key; renderFilters(); renderList(); };
    return c;
  };
  el.appendChild(mk(null, '전체', state.posts.length, state.statusFilter === null));
  for (const s of ['local', 'modified', 'draft', 'scheduled', 'published']) {
    if (counts[s]) el.appendChild(mk(s, BADGE[s], counts[s], state.statusFilter === s));
  }
}

function filteredPosts() {
  const q = state.search.toLowerCase();
  return state.posts.filter((p) => {
    if (state.statusFilter && p.status !== state.statusFilter) return false;
    if (q && !(p.title + ' ' + p.labels.join(' ')).toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderList() {
  const list = $('post-list');
  const items = filteredPosts();
  if (!items.length) {
    list.innerHTML = '<li class="list-empty">글이 없습니다.</li>';
    return;
  }
  list.innerHTML = items.map((p) => {
    const drift = state.drift.has(p.file);
    const sel = state.selection.has(p.file);
    const badge = drift
      ? '<span class="badge drift">원격변경</span>'
      : `<span class="badge ${p.status}">${BADGE[p.status]}</span>`;
    const labels = p.labels.length ? `<span class="pi-labels">${escapeHtml(p.labels.join(', '))}</span>` : '';
    return `<li class="post-item ${state.current?.file === p.file ? 'active' : ''} ${sel ? 'sel' : ''}" data-file="${escapeHtml(p.file)}">
      <input type="checkbox" class="pi-check" data-file="${escapeHtml(p.file)}" ${sel ? 'checked' : ''} />
      <div class="pi-main">
        <div class="pi-title">${escapeHtml(p.title)}</div>
        <div class="pi-meta">${badge}<span>${p.date || ''}</span>${labels}</div>
      </div></li>`;
  }).join('');
}

// ── 선택(일괄) ────────────────────────────────────
function toggleSelect(file, on) {
  if (on) state.selection.add(file);
  else state.selection.delete(file);
  renderBulk();
  renderList();
}
function clearSelection() { state.selection.clear(); renderBulk(); renderList(); }
function renderBulk() {
  const bar = $('bulkbar');
  const n = state.selection.size;
  bar.hidden = n === 0;
  document.body.classList.toggle('selecting', n > 0);
  if (n) $('bulk-count').textContent = `${n}개 선택`;
}

async function bulkPublish() {
  const files = [...state.selection];
  if (!files.length) return;
  setBusy(true);
  let ok = 0;
  try {
    for (const file of files) {
      try { await api('/api/publish', { method: 'POST', body: { file } }); ok++; } catch {}
    }
    toast(`${ok}/${files.length}개 발행 처리 완료`, 'ok');
    clearSelection();
    await loadPosts();
  } finally { setBusy(false); }
}
async function bulkDelete() {
  const files = [...state.selection];
  if (!files.length) return;
  if (!confirm(`${files.length}개 글을 로컬에서 삭제할까요? (원격 발행본은 유지)`)) return;
  setBusy(true);
  try {
    for (const file of files) {
      try { await api('/api/posts/' + encodeURIComponent(file), { method: 'DELETE' }); } catch {}
    }
    toast(`${files.length}개 삭제됨`, 'ok');
    clearSelection();
    await loadPosts();
  } finally { setBusy(false); }
}

// ── 드리프트 ──────────────────────────────────────
async function checkDrift() {
  setBusy(true);
  try {
    const { drifted } = await api('/api/drift');
    state.drift = new Set(drifted.map((d) => d.file));
    renderList();
    toast(drifted.length ? `⚠ Blogger에서 직접 변경된 글 ${drifted.length}개 (발행 시 덮어씀 주의)` : '원격과 동기화됨 ✓', drifted.length ? 'err' : 'ok');
  } catch (e) { toast('원격 확인 실패: ' + e.message, 'err'); }
  finally { setBusy(false); }
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
  $('f-publishat').value = p.data.publishAt || '';
  $('f-draft').checked = p.data.draft === true;
  $('f-content').value = p.content || '';
  $('file-name').textContent = file;
  const meta = state.posts.find((x) => x.file === file);
  const remote = $('open-remote');
  if (meta?.url && meta.status !== 'local') { remote.hidden = false; remote.href = meta.url; }
  else remote.hidden = true;
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
      publishAt: $('f-publishat').value || undefined,
    },
    content: $('f-content').value,
  };
}
function markDirty(v) { state.dirty = v; $('dirty').textContent = v ? '● 저장 안 됨' : ''; }

async function saveCurrent(silent) {
  if (!state.current) return;
  const payload = collect();
  await api('/api/posts/' + encodeURIComponent(state.current.file), { method: 'PUT', body: payload });
  state.current.data = payload.data;
  state.current.content = payload.content;
  markDirty(false);
  if (!silent) { const m = $('status-msg'); m.textContent = '저장됨 ✓'; m.className = 'status-msg ok'; setTimeout(() => (m.textContent = ''), 2000); }
  await loadPosts();
  await loadLabels();
}
const autosave = debounce(() => { if (state.dirty && state.current) saveCurrent(true); }, 1500);
const updatePreview = debounce(async () => {
  try { const { html } = await api('/api/render', { method: 'POST', body: { markdown: $('f-content').value } }); $('preview').innerHTML = html; } catch {}
}, 220);
function onEdit() { markDirty(true); updatePreview(); autosave(); }

// ── 새 글 / 삭제 / 발행 ───────────────────────────
async function createNew() {
  const title = prompt('새 글 제목:', '제목 없음');
  if (title === null) return;
  const { file } = await api('/api/posts', { method: 'POST', body: { title, draft: true, content: '# ' + title + '\n\n' } });
  await loadPosts();
  await openPost(file);
  $('f-title').focus();
  $('f-title').select();
}
async function deleteCurrent() {
  if (!state.current) return;
  const meta = state.posts.find((x) => x.file === state.current.file);
  let remote = false;
  if (meta && meta.status !== 'local') remote = confirm('Blogger에 발행된 글입니다.\n확인=원격에서도 삭제, 취소=로컬 파일만 삭제');
  else if (!confirm('이 글을 삭제할까요?')) return;
  await api('/api/posts/' + encodeURIComponent(state.current.file) + (remote ? '?remote=true' : ''), { method: 'DELETE' });
  state.current = null; state.dirty = false;
  $('editor-inner').hidden = true; $('empty-state').hidden = false;
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
    const meta = state.posts.find((x) => x.file === state.current.file);
    if (meta?.url) { $('open-remote').hidden = false; $('open-remote').href = meta.url; }
  } catch (e) { toast('발행 실패: ' + e.message, 'err'); }
  finally { setBusy(false); }
}
async function publishAll(dryRun) {
  setBusy(true);
  try {
    const { results } = await api('/api/publish', { method: 'POST', body: { dryRun } });
    const c = { create: 0, update: 0, skip: 0 };
    for (const r of results) c[r.action] = (c[r.action] || 0) + 1;
    toast(`${dryRun ? '[미리보기] ' : ''}신규 ${c.create}, 업데이트 ${c.update}, 스킵 ${c.skip}`, 'ok');
    if (!dryRun) await loadPosts();
  } catch (e) { toast('발행 실패: ' + e.message, 'err'); }
  finally { setBusy(false); }
}
async function importRemote() {
  if (!confirm('Blogger의 기존 글을 로컬 마크다운으로 가져올까요?\n(이미 있는 글은 건너뜁니다)')) return;
  setBusy(true);
  try {
    const { count } = await api('/api/import', { method: 'POST' });
    toast(count ? `${count}개 글을 가져왔습니다.` : '가져올 새 글이 없습니다.', 'ok');
    await loadPosts(); await loadLabels();
  } catch (e) { toast('가져오기 실패: ' + e.message, 'err'); }
  finally { setBusy(false); }
}
function setBusy(b) {
  for (const id of ['btn-publish', 'btn-publish-all', 'btn-import', 'btn-dry', 'btn-save', 'btn-drift', 'bulk-publish', 'bulk-delete'])
    { const el = $(id); if (el) el.disabled = b; }
}

// ── 마크다운 툴바 ─────────────────────────────────
// setRangeText 사용: 텍스트 전체를 재할당하지 않아 실행취소(⌘Z) 스택이 덜 깨진다.
function surround(before, after, placeholder) {
  const ta = $('f-content');
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || placeholder || '';
  ta.focus();
  ta.setRangeText(before + sel + after, s, e, 'end');
  ta.setSelectionRange(s + before.length, s + before.length + sel.length);
  onEdit();
}
function prefixLines(prefix) {
  const ta = $('f-content');
  const s = ta.selectionStart, e = ta.selectionEnd;
  const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
  const block = ta.value.slice(lineStart, e);
  const replaced = block.split('\n').map((l) => prefix + l).join('\n');
  ta.focus();
  ta.setRangeText(replaced, lineStart, e, 'end');
  onEdit();
}
function insertAtCursor(text) {
  const ta = $('f-content');
  const s = ta.selectionStart;
  ta.focus();
  ta.setRangeText(text, s, ta.selectionEnd, 'end');
  onEdit();
}
const TB = {
  bold: () => surround('**', '**', '굵게'),
  italic: () => surround('*', '*', '기울임'),
  strike: () => surround('~~', '~~', '취소선'),
  code: () => surround('`', '`', '코드'),
  link: () => surround('[', '](https://)', '링크'),
  h2: () => prefixLines('## '),
  quote: () => prefixLines('> '),
  ul: () => prefixLines('- '),
  image: () => $('img-input').click(),
  gsearch: () => {
    const q = prompt('Google 검색 미리보기로 넣을 검색어 (인기 인물·장소·키워드):');
    if (!q) return;
    const enc = encodeURIComponent(q);
    const card =
      `\n<a href="https://www.google.com/search?q=${enc}" target="_blank" rel="noopener" ` +
      `style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border:1px solid #dadce0;` +
      `border-radius:24px;text-decoration:none;color:#1a73e8;font-weight:600;box-shadow:0 1px 3px rgba(60,64,67,.15)">` +
      `<span style="font-weight:800;background:linear-gradient(90deg,#4285f4,#ea4335,#fbbc05,#34a853);` +
      `-webkit-background-clip:text;background-clip:text;color:transparent">G</span> ` +
      `${escapeHtml(q)} — Google 검색</a>\n`;
    insertAtCursor(card);
  },
};

// ── 이미지 업로드 ─────────────────────────────────
async function uploadImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
    });
    const { markdown } = await api('/api/upload', { method: 'POST', body: { filename: file.name || 'image.png', dataUrl } });
    insertAtCursor('\n' + markdown + '\n');
    toast('이미지 업로드됨 · git push 후 블로그에 표시됩니다', 'ok');
  } catch (e) { toast('업로드 실패: ' + e.message, 'err'); }
}

// ── 라벨 자동완성 ─────────────────────────────────
let suggestIdx = -1;
function currentToken(input) {
  const v = input.value, pos = input.selectionStart;
  const start = v.lastIndexOf(',', pos - 1) + 1;
  return { start, end: pos, text: v.slice(start, pos).trim() };
}
function showLabelSuggest() {
  const input = $('f-labels');
  const box = $('label-suggest');
  const tok = currentToken(input);
  const used = input.value.split(',').map((s) => s.trim());
  const matches = state.labels.filter((l) => !used.includes(l) && (tok.text === '' ? true : l.toLowerCase().includes(tok.text.toLowerCase()))).slice(0, 8);
  if (!matches.length) { box.hidden = true; return; }
  suggestIdx = -1;
  box.innerHTML = matches.map((l, i) => `<div data-label="${escapeHtml(l)}">${escapeHtml(l)}</div>`).join('');
  box.hidden = false;
}
function applyLabel(label) {
  const input = $('f-labels');
  const tok = currentToken(input);
  const before = input.value.slice(0, tok.start).replace(/\s*$/, '');
  const rest = input.value.slice(tok.end);
  const prefix = before ? before + ', ' : '';
  input.value = prefix + label + (rest.trim().startsWith(',') ? rest : ', ');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  $('label-suggest').hidden = true;
  onEdit();
}

// ── 이벤트 ────────────────────────────────────────
function bind() {
  $('btn-new').onclick = createNew;
  $('btn-save').onclick = () => saveCurrent(false);
  $('btn-publish').onclick = publishOne;
  $('btn-delete').onclick = deleteCurrent;
  $('btn-publish-all').onclick = () => publishAll(false);
  $('btn-dry').onclick = () => publishAll(true);
  $('btn-import').onclick = importRemote;
  $('btn-drift').onclick = checkDrift;
  $('bulk-publish').onclick = bulkPublish;
  $('bulk-delete').onclick = bulkDelete;
  $('bulk-clear').onclick = clearSelection;

  for (const id of ['f-title', 'f-date', 'f-publishat', 'f-content']) $(id).addEventListener('input', onEdit);
  $('f-draft').addEventListener('change', onEdit);

  // 목록: 체크박스=선택, 나머지=열기
  $('post-list').addEventListener('click', (e) => {
    const cb = e.target.closest('.pi-check');
    if (cb) { e.stopPropagation(); toggleSelect(cb.dataset.file, cb.checked); return; }
    const li = e.target.closest('.post-item');
    if (li) openPost(li.dataset.file);
  });

  // 검색
  $('search').addEventListener('input', (e) => { state.search = e.target.value; renderList(); });

  // 툴바
  $('toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('.tb'); if (!b) return;
    const fn = TB[b.dataset.md]; if (fn) fn();
  });

  // 이미지 파일 input
  const imgInput = document.createElement('input');
  imgInput.type = 'file'; imgInput.accept = 'image/*'; imgInput.id = 'img-input'; imgInput.hidden = true;
  imgInput.addEventListener('change', () => { if (imgInput.files[0]) uploadImage(imgInput.files[0]); imgInput.value = ''; });
  document.body.appendChild(imgInput);

  // 드래그&드롭
  const wrap = $('content-wrap');
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('dragover'); $('drop-hint').hidden = false; });
  wrap.addEventListener('dragleave', (e) => { if (e.target === wrap || !wrap.contains(e.relatedTarget)) { wrap.classList.remove('dragover'); $('drop-hint').hidden = true; } });
  wrap.addEventListener('drop', (e) => {
    e.preventDefault(); wrap.classList.remove('dragover'); $('drop-hint').hidden = true;
    for (const f of e.dataTransfer.files) uploadImage(f);
  });
  // 붙여넣기
  $('f-content').addEventListener('paste', (e) => {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); uploadImage(item.getAsFile()); }
  });

  // 라벨 자동완성
  const labelInput = $('f-labels');
  labelInput.addEventListener('input', () => { onEdit(); showLabelSuggest(); });
  labelInput.addEventListener('focus', showLabelSuggest);
  labelInput.addEventListener('blur', () => setTimeout(() => ($('label-suggest').hidden = true), 150));
  labelInput.addEventListener('keydown', (e) => {
    const box = $('label-suggest'); if (box.hidden) return;
    const opts = [...box.children];
    if (e.key === 'ArrowDown') { e.preventDefault(); suggestIdx = Math.min(suggestIdx + 1, opts.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); suggestIdx = Math.max(suggestIdx - 1, 0); }
    else if (e.key === 'Enter' && suggestIdx >= 0) { e.preventDefault(); applyLabel(opts[suggestIdx].dataset.label); return; }
    else if (e.key === 'Escape') { box.hidden = true; return; }
    else return;
    opts.forEach((o, i) => o.classList.toggle('active', i === suggestIdx));
  });
  $('label-suggest').addEventListener('mousedown', (e) => {
    const d = e.target.closest('[data-label]'); if (d) { e.preventDefault(); applyLabel(d.dataset.label); }
  });

  // 단축키
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); saveCurrent(false); }
    else if (document.activeElement === $('f-content')) {
      if (k === 'b') { e.preventDefault(); TB.bold(); }
      else if (k === 'i') { e.preventDefault(); TB.italic(); }
      else if (k === 'k') { e.preventDefault(); TB.link(); }
    }
  });

  window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
}

// ── 시작 ──────────────────────────────────────────
bind();
loadStatus();
loadLabels();
loadPosts();
