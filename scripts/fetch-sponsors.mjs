// Fetch afdian sponsor list → sponsors.json + README wall section.
// Runs in GitHub Actions only — the API token must never ship in the extension.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const user_id = process.env.AFDIAN_USER_ID;
const token = process.env.AFDIAN_TOKEN;
if (!user_id || !token) {
  console.error('AFDIAN_USER_ID / AFDIAN_TOKEN env required');
  process.exit(1);
}

const params = JSON.stringify({ page: 1, per_page: 100 });
const ts = Math.floor(Date.now() / 1000);
// sign = md5(token + "params" + params + "ts" + ts + "user_id" + user_id)
const sign = createHash('md5').update(`${token}params${params}ts${ts}user_id${user_id}`).digest('hex');

const res = await fetch('https://ifdian.net/api/open/query-sponsor', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user_id, params, ts, sign }),
});
const json = await res.json();
if (json.ec !== 200) {
  console.error('afdian API error:', JSON.stringify(json));
  process.exit(1);
}

const sponsors = json.data.list
  .filter((s) => Number(s.all_sum_amount) > 0)
  .map((s) => ({ name: s.user.name, avatar: s.user.avatar, amount: s.all_sum_amount }))
  .sort((a, b) => Number(b.amount) - Number(a.amount));

writeFileSync(
  'sponsors.json',
  JSON.stringify({ updated: new Date().toISOString().slice(0, 10), total: sponsors.length, sponsors }, null, 2),
);

// Update README wall between markers.
const wall = sponsors.length
  ? sponsors.map((s) => s.name.replace(/[[\]|]/g, '')).join(' · ')
  : '还没有赞助者，来当第一个 ♥';
const readme = readFileSync('README.md', 'utf8');
const updated = readme.replace(
  /(<!-- SPONSORS:START -->)[\s\S]*?(<!-- SPONSORS:END -->)/,
  `$1\n${wall}\n$2`,
);
if (updated !== readme) writeFileSync('README.md', updated);

console.log(`wrote ${sponsors.length} sponsors`);
