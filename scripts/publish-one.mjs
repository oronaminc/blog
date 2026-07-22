import 'dotenv/config';
import { getStatuses, publishPosts } from './lib/publisher.mjs';

// 미발행/수정된 글 중 딱 한 편만 발행한다(슬로우 드립용).
const statuses = await getStatuses();
const pending = statuses.find((s) => s.status === 'local' || s.status === 'modified');

if (!pending) {
  console.log('ALL_DONE 모두 발행 완료');
  process.exit(0);
}

try {
  await publishPosts({ only: pending.file, onLog: (m) => console.log(m) });
  console.log(`ONE_OK ${pending.file}`);
  process.exit(0);
} catch (err) {
  const msg = err.message || String(err);
  if (msg.includes('403')) console.log('BLOCKED 403 계정 본인확인 필요');
  else console.log('ERROR ' + msg.slice(0, 120));
  process.exit(1);
}
