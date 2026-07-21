import { readdir, readFile, writeFile, unlink, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import matter from 'gray-matter';

// posts/ 디렉터리의 마크다운 파일 CRUD. CLI(publish.mjs)와 웹서버가 공용으로 사용.
export const POSTS_DIR = new URL('../../posts/', import.meta.url);
export const ASSETS_DIR = new URL('../../assets/', import.meta.url);

function fileUrl(file) {
  return new URL(assertSafeFile(file), POSTS_DIR);
}

// 경로 탈출(../) 방지: 순수 파일명(.md)만 허용
export function assertSafeFile(file) {
  if (typeof file !== 'string' || !file.endsWith('.md') || file.includes('/') || file.includes('\\') || file.includes('..')) {
    throw new Error(`잘못된 파일명: ${file}`);
  }
  return file;
}

export function normalizeLabels(labels) {
  if (Array.isArray(labels)) return labels.map((l) => String(l).trim()).filter(Boolean);
  if (typeof labels === 'string' && labels.trim()) {
    return labels.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export async function listPostFiles() {
  const entries = await readdir(POSTS_DIR, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort()
    .reverse(); // 최신(파일명 날짜) 먼저
}

// YAML 의 date 값(문자열/Date)을 항상 YYYY-MM-DD 문자열로 정규화
export function normalizeDate(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') {
    const m = v.match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : v;
  }
  return v;
}

// datetime 값(문자열/Date)을 "YYYY-MM-DDTHH:MM"(datetime-local 형식) 문자열로 정규화.
// js-yaml 은 타임존 없는 타임스탬프를 UTC Date 로 파싱하므로 UTC 구성요소로 되돌린다.
export function normalizeDateTime(v) {
  if (v instanceof Date && !isNaN(v)) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}T${p(v.getUTCHours())}:${p(v.getUTCMinutes())}`;
  }
  if (typeof v === 'string') {
    const m = v.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    return m ? m[0] : v;
  }
  return v;
}

export async function readPost(file) {
  const raw = await readFile(fileUrl(file), 'utf8');
  const { data, content } = matter(raw);
  if (data.date != null) data.date = normalizeDate(data.date);
  if (data.publishAt != null) data.publishAt = normalizeDateTime(data.publishAt);
  return { file, data, content, raw };
}

export async function writePost(file, { data = {}, content = '' }) {
  const safe = assertSafeFile(file);
  await mkdir(POSTS_DIR, { recursive: true });
  const raw = matter.stringify(content, data);
  // 원자적 저장: 임시파일에 쓰고 rename (저장 중 크래시로 인한 손상 방지)
  const tmp = new URL(safe + '.tmp', POSTS_DIR);
  await writeFile(tmp, raw);
  await rename(tmp, new URL(safe, POSTS_DIR));
  return { file };
}

export async function deletePost(file) {
  await unlink(fileUrl(file));
  return { file };
}

export function slugify(str) {
  const s = String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'post';
}

// 로컬 타임존 기준 오늘 날짜 (YYYY-MM-DD)
export function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function makeFilename(title, date) {
  const d = date || today();
  return `${d}-${slugify(title)}.md`;
}

// 모든 글의 라벨을 수집(중복 제거·정렬) — 자동완성용
export async function listAllLabels() {
  const files = await listPostFiles();
  const set = new Set();
  for (const f of files) {
    const { data } = await readPost(f);
    for (const l of normalizeLabels(data.labels)) set.add(l);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
}

// 이미지 등 에셋을 assets/ 에 저장(파일명 충돌 방지). 반환: 저장된 파일명
export async function saveAsset(filename, buffer) {
  await mkdir(ASSETS_DIR, { recursive: true });
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase().replace(/[^.\w]/g, '') : '';
  const stem = (dot >= 0 ? filename.slice(0, dot) : filename)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'image';
  let name = `${stem}${ext}`;
  let n = 2;
  while (existsSync(new URL(name, ASSETS_DIR))) {
    name = `${stem}-${n}${ext}`;
    n += 1;
  }
  await writeFile(new URL(name, ASSETS_DIR), buffer);
  return name;
}

// 파일명 충돌 시 -2, -3 … suffix 를 붙여 덮어쓰기 방지
export function uniqueFilename(title, date) {
  const base = makeFilename(title, date);
  let file = base;
  let n = 2;
  while (existsSync(new URL(file, POSTS_DIR))) {
    file = base.replace(/\.md$/, `-${n}.md`);
    n += 1;
  }
  return file;
}
