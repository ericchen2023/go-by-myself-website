import { spawnSync } from 'node:child_process';

const configuredPython = process.env.PYTHON?.trim();
const candidates = configuredPython
  ? [configuredPython]
  : process.platform === 'win32'
    ? ['python', 'python3']
    : ['python3', 'python'];

let pythonCommand = '';
const diagnostics = [];

for (const candidate of candidates) {
  const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', shell: false });
  if (result.error || result.status !== 0) {
    diagnostics.push(`${candidate}: unavailable`);
    continue;
  }

  const versionText = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  const match = versionText.match(/Python\s+(\d+)\.(\d+)/i);
  if (!match) {
    diagnostics.push(`${candidate}: unrecognized version (${versionText || 'no output'})`);
    continue;
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major < 3 || (major === 3 && minor < 10)) {
    diagnostics.push(`${candidate}: ${versionText} is too old; Python 3.10+ is required`);
    continue;
  }

  pythonCommand = candidate;
  process.stdout.write(`Using ${candidate} (${versionText}).\n`);
  break;
}

if (!pythonCommand) {
  process.stderr.write(
    `Python 3.10+ was not found. Install Python or set PYTHON to its executable path.\n${diagnostics.join('\n')}\n`
  );
  process.exit(1);
}

const test = spawnSync(
  pythonCommand,
  ['-m', 'unittest', 'discover', '-s', 'gateway/python_agent', '-p', 'test_*.py'],
  { stdio: 'inherit', shell: false }
);

if (test.error) {
  process.stderr.write(`Unable to start Python tests: ${test.error.message}\n`);
  process.exit(1);
}

if (test.signal) {
  process.stderr.write(`Python tests stopped by signal ${test.signal}.\n`);
  process.exit(1);
}

process.exit(test.status ?? 1);
