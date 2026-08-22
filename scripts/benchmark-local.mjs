import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
let previewProcess = null;

if (!process.argv[2]) {
  const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  previewProcess = spawn(process.execPath, [viteBin, 'preview', '--outDir', 'dist-demo'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    windowsHide: true
  });
  process.once('exit', () => previewProcess?.kill());
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await delay(100);
    }
  }
  if (!ready) throw new Error(`Local preview did not become ready at ${url}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
await page.addInitScript(() => {
  window.__gbmLcp = 0;
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    window.__gbmLcp = entries.at(-1)?.startTime ?? window.__gbmLcp;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
});
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

const browserMetrics = await page.evaluate(() => {
  const navigation = /** @type {PerformanceNavigationTiming} */ (performance.getEntriesByType('navigation')[0]);
  const paint = performance.getEntriesByType('paint');
  const resources = /** @type {PerformanceResourceTiming[]} */ (performance.getEntriesByType('resource'));
  const fcp = paint.find((entry) => entry.name === 'first-contentful-paint')?.startTime ?? null;
  return {
    ttfbMs: navigation.responseStart - navigation.requestStart,
    fcpMs: fcp,
    lcpMs: window.__gbmLcp || null,
    domInteractiveMs: navigation.domInteractive - navigation.startTime,
    domCompleteMs: navigation.domComplete - navigation.startTime,
    fullLoadMs: navigation.loadEventEnd - navigation.startTime,
    requestCount: resources.length + 1,
    transferBytes: resources.reduce((total, entry) => total + (entry.transferSize || 0), navigation.transferSize || 0)
  };
});

async function gzipTotal(directory, extension) {
  const manifest = JSON.parse(await readFile(`${directory}/.vite/manifest.json`, 'utf8').catch(() => '{}'));
  void manifest;
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(`${directory}/assets`);
  let total = 0;
  for (const file of files.filter((name) => name.endsWith(extension))) {
    total += gzipSync(await readFile(`${directory}/assets/${file}`)).byteLength;
  }
  return total;
}

const jsGzipBytes = await gzipTotal('dist-demo', '.js');
const cssGzipBytes = await gzipTotal('dist-demo', '.css');
const metrics = {
  url,
  measuredAt: new Date().toISOString(),
  ...browserMetrics,
  jsGzipBytes,
  cssGzipBytes,
  budgets: {
    fcp: browserMetrics.fcpMs !== null && browserMetrics.fcpMs <= 1800,
    lcp: browserMetrics.lcpMs !== null && browserMetrics.lcpMs <= 2500,
    js: jsGzipBytes <= 150 * 1024,
    css: cssGzipBytes <= 30 * 1024,
    requests: browserMetrics.requestCount <= 50
  }
};

await mkdir('.gstack/benchmark-reports', { recursive: true });
await writeFile('.gstack/benchmark-reports/latest.json', JSON.stringify(metrics, null, 2));
process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
await browser.close();
previewProcess?.kill();

if (Object.values(metrics.budgets).some((passed) => !passed)) process.exitCode = 1;
