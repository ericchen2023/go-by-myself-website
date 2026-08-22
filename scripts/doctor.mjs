import { access, constants } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const checks = [];
const nodeMajor = Number(process.versions.node.split('.')[0]);

checks.push({
  name: `Node ${process.versions.node}`,
  ok: nodeMajor >= 22 && nodeMajor < 25,
  note: nodeMajor === 24 ? '符合專案 Node 24 LTS 基準' : '可開發；CI 與正式環境固定 Node 24 LTS'
});

for (const command of ['npm', 'git']) {
  try {
    let version;
    if (command === 'npm' && process.env.npm_config_user_agent) {
      version = process.env.npm_config_user_agent.match(/npm\/([^\s]+)/)?.[1] ?? 'available';
    } else {
      version = execFileSync(command, ['--version'], { encoding: 'utf8' }).trim();
    }
    checks.push({ name: `${command} ${version}`, ok: true, note: '' });
  } catch {
    checks.push({ name: command, ok: false, note: '找不到命令' });
  }
}

for (const file of ['package-lock.json', '.env.example', 'contracts/delivery-command.schema.json']) {
  try {
    await access(file, constants.R_OK);
    checks.push({ name: file, ok: true, note: '可讀取' });
  } catch {
    checks.push({ name: file, ok: false, note: '缺少檔案；先執行 npm install 或確認 clone 完整' });
  }
}

for (const check of checks) {
  const symbol = check.ok ? '✓' : '✗';
  process.stdout.write(`${symbol} ${check.name}${check.note ? ` — ${check.note}` : ''}\n`);
}

if (checks.some((check) => !check.ok)) process.exitCode = 1;
