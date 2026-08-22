import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function filesUnder(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const violations = [];
for (const file of await filesUnder('src/production')) {
  const source = await readFile(file, 'utf8');
  if (/from\s+['"][^'"]*(?:demo|simulator)[^'"]*['"]/.test(source)) {
    violations.push(`${file}: production imports demo/simulator`);
  }
}

const viteConfig = await readFile('vite.config.js', 'utf8');
if (!viteConfig.includes("'#runtime-adapter'")) {
  violations.push('vite.config.js: missing build-time runtime adapter alias');
}
if (!viteConfig.includes("'#mode-presentation'")) {
  violations.push('vite.config.js: missing build-time mode presentation alias');
}

const main = await readFile('src/main.js', 'utf8');
if (!main.includes("from '#runtime-adapter'")) {
  violations.push('src/main.js: runtime adapter is not selected through build-time alias');
}
if (/from\s+['"][^'"]*\/demo\//.test(main) || /from\s+['"][^'"]*\/production\//.test(main)) {
  violations.push('src/main.js: direct mode-specific import bypasses alias');
}

const application = await readFile('src/app/application.js', 'utf8');
if (!application.includes("from '#mode-presentation'")) {
  violations.push('src/app/application.js: mode capabilities are not selected through build-time alias');
}
if (/state\.mode\s*===|state\.mode\s*!==/.test(application)) {
  violations.push('src/app/application.js: runtime mode switch can retain disabled capabilities in production');
}

if (violations.length) {
  process.stderr.write(`${violations.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('Mode boundary valid: production source has no demo/simulator imports or runtime capability switch.\n');
