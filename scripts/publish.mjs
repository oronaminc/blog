import 'dotenv/config';
import { publishPosts } from './lib/publisher.mjs';

// CLI 래퍼. 실제 로직은 lib/publisher.mjs 에 있고 웹서버와 공용.
const DRY_RUN = process.argv.includes('--dry-run');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length) : null;

try {
  const results = await publishPosts({ dryRun: DRY_RUN, only, onLog: (m) => console.log(m) });
  const c = { create: 0, update: 0, skip: 0 };
  for (const r of results) c[r.action] = (c[r.action] || 0) + 1;
  console.log(`\n완료 — 신규 ${c.create || 0}, 업데이트 ${c.update || 0}, 스킵 ${c.skip || 0}`);
} catch (err) {
  console.error('❌', err.message);
  process.exit(1);
}
