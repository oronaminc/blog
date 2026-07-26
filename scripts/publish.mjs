import 'dotenv/config';
import { publishPosts } from './lib/publisher.mjs';

// CLI 래퍼. 실제 로직은 lib/publisher.mjs. 웹서버와 공용.
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const onlyArg = argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length) : null;
const targetsArg = argv.find((a) => a.startsWith('--targets='));
const targets = targetsArg ? targetsArg.slice('--targets='.length).split(',').map((s) => s.trim()).filter(Boolean) : null;

try {
  const results = await publishPosts({ dryRun: DRY_RUN, only, targets, onLog: (m) => console.log(m) });
  const c = { create: 0, update: 0, skip: 0, error: 0, blocked: 0 };
  for (const r of results) for (const t of Object.values(r.targets)) c[t.action] = (c[t.action] || 0) + 1;
  console.log(`\n완료 — 신규 ${c.create}, 업데이트 ${c.update}, 스킵 ${c.skip}, 실패 ${c.error}, 차단 ${c.blocked}`);
  if (c.blocked) process.exit(2);
} catch (err) {
  console.error('❌', err.message);
  process.exit(1);
}
