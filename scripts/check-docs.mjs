import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set([
  '.git',
  'coverage',
  'dist-demo',
  'dist-production',
  'node_modules',
  'playwright-report',
  'test-results'
]);

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') files.push(path);
  }
  return files;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const brokenLinks = [];
for (const file of await markdownFiles(root)) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:https?:\/\/|mailto:|#)/i.test(target)) continue;
    target = target.split('#', 1)[0];
    if (!target) continue;
    const resolved = resolve(dirname(file), decodeURIComponent(target));
    if (!await pathExists(resolved)) {
      brokenLinks.push(`${file.slice(root.length + 1)} -> ${target}`);
    }
  }
}

const routeGraph = JSON.parse(await readFile(join(root, 'contracts', 'route-graph.v4.json'), 'utf8'));
const handoff = await readFile(join(root, 'docs', 'VEHICLE_PC_AI_HANDOFF.md'), 'utf8');
const expectedStops = ['LIBRARY', 'ADMIN', 'HSS1', 'HSS2'];
const activeStops = routeGraph.locations.filter((location) => location.active).map((location) => location.code);

const contractErrors = [];
if (!handoff.includes(`routeGraphVersion: ${routeGraph.version}`)) {
  contractErrors.push(`handoff routeGraphVersion does not match ${routeGraph.version}`);
}
if (!handoff.includes(`routeGraphChecksum: ${routeGraph.checksum}`)) {
  contractErrors.push(`handoff routeGraphChecksum does not match ${routeGraph.checksum}`);
}
if (JSON.stringify(activeStops) !== JSON.stringify(expectedStops)) {
  contractErrors.push(`canonical active stops changed: ${activeStops.join(', ')}`);
}
if (!handoff.includes(`visible stops: ${expectedStops.join(', ')}`)) {
  contractErrors.push('handoff visible stop list does not match the canonical four stops');
}

const failures = [...brokenLinks, ...contractErrors];
if (failures.length > 0) {
  process.stderr.write(`Documentation verification failed:\n- ${failures.join('\n- ')}\n`);
  process.exit(1);
}

process.stdout.write(
  `Documentation verified: local links resolve and handoff pins ${routeGraph.version} (${routeGraph.checksum}).\n`
);
