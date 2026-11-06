import { gzipSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const budgets = {
  '.js': 150 * 1024,
  '.css': 30 * 1024
};

async function assetFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await assetFiles(path));
    else if (budgets[extname(entry.name)]) files.push(path);
  }
  return files;
}

let failed = false;
// 路線圖版本 ID（ndhu-four-stop-route-v5 等）是車端已釘住的內部協定字串，
// 不會顯示在畫面上，因此排除；其他任何校名寫法都視為違規。
const schoolNamePattern = /NDHU(?!-four-stop-route|-supplied-schematic)|東華|Dong\s*Hwa/i;
const forbiddenProductionMarkers = [
  'DEMO 4826',
  '情境模擬器',
  '以展示身份開始八步流程',
  'happy-path',
  'DEMO_PICKUP',
  '模擬物品已取出並關門',
  '展示模式使用測試帳號與模擬車輛',
  '開始展示投遞'
];
const forbiddenBrowserSecretMarkers = [
  'SUPABASE_SECRET_KEYS',
  'SUPABASE_SECRET_KEY',
  'CREDENTIAL_PEPPER',
  'ROBOT_GATEWAY_TOKEN',
  'ROBOT_PRIVATE_KEY',
  'SMS_PROVIDER_API_KEY',
  'PROVIDER_WEBHOOK_SECRET'
];
for (const root of ['dist-demo', 'dist-production']) {
  const totals = { '.js': 0, '.css': 0 };
  for (const file of await assetFiles(root)) {
    const extension = extname(file);
    const contents = await readFile(file);
    totals[extension] += gzipSync(contents).byteLength;
    if (extension === '.js') {
      const source = contents.toString('utf8');
      for (const marker of forbiddenBrowserSecretMarkers) {
        if (source.includes(marker)) {
          process.stderr.write(`${file}: browser artifact contains server/robot secret marker "${marker}"\n`);
          failed = true;
        }
      }
      if (root === 'dist-production') {
        for (const marker of forbiddenProductionMarkers) {
          if (source.includes(marker)) {
            process.stderr.write(`${file}: production artifact contains demo marker "${marker}"\n`);
            failed = true;
          }
        }
      }
    }
  }

  // 網站不得出現任何校名、校徽或學校網域（含 index.html 與靜態資產路徑）。
  for (const file of [join(root, 'index.html'), ...await assetFiles(root)]) {
    const source = await readFile(file, 'utf8');
    const match = source.match(schoolNamePattern);
    if (match) {
      process.stderr.write(`${file}: artifact contains school name "${match[0]}"\n`);
      failed = true;
    }
  }

  for (const [extension, total] of Object.entries(totals)) {
    const limit = budgets[extension];
    process.stdout.write(`${root} ${extension}: ${(total / 1024).toFixed(1)} KiB gzip / ${(limit / 1024).toFixed(0)} KiB\n`);
    if (total > limit) failed = true;
  }
}

if (failed) {
  process.stderr.write('Bundle policy failed.\n');
  process.exit(1);
}
