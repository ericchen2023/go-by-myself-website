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

async function collectBrowserMetrics(launchOptions, engine) {
  const browser = await chromium.launch({ headless: true, ...launchOptions });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      window.__gbmLcp = 0;
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        window.__gbmLcp = entries.at(-1)?.startTime ?? window.__gbmLcp;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    // Windows headless browsers can emit paint entries well after network idle.
    // Waiting here records the paint timestamp; it does not inflate startTime.
    await page.waitForTimeout(2500);

    return await page.evaluate((browserEngine) => {
      const navigation = /** @type {PerformanceNavigationTiming} */ (performance.getEntriesByType('navigation')[0]);
      const paint = performance.getEntriesByType('paint');
      const resources = /** @type {PerformanceResourceTiming[]} */ (performance.getEntriesByType('resource'));
      const fcp = paint.find((entry) => entry.name === 'first-contentful-paint')?.startTime ?? null;
      return {
        engine: browserEngine,
        ttfbMs: navigation.responseStart - navigation.requestStart,
        fcpMs: fcp,
        lcpMs: window.__gbmLcp || null,
        domInteractiveMs: navigation.domInteractive - navigation.startTime,
        domCompleteMs: navigation.domComplete - navigation.startTime,
        fullLoadMs: navigation.loadEventEnd - navigation.startTime,
        requestCount: resources.length + 1,
        transferBytes: resources.reduce((total, entry) => total + (entry.transferSize || 0), navigation.transferSize || 0)
      };
    }, engine);
  } finally {
    await browser.close();
  }
}

const browserCandidates = process.platform === 'win32'
  ? [
      [{ channel: 'msedge' }, 'system-msedge'],
      [{ channel: 'chrome' }, 'system-chrome'],
      [{}, 'playwright-chromium']
    ]
  : [
      [{}, 'playwright-chromium'],
      [{ channel: 'chrome' }, 'system-chrome']
    ];

let browserMetrics = null;
for (const [launchOptions, engine] of browserCandidates) {
  try {
    const candidateMetrics = await collectBrowserMetrics(launchOptions, engine);
    if (candidateMetrics.fcpMs !== null && candidateMetrics.lcpMs !== null) {
      browserMetrics = candidateMetrics;
      break;
    }
  } catch {
    // Optional system browser channels are not installed on every CI worker.
  }
}
if (browserMetrics === null) throw new Error('No browser emitted FCP and LCP timing entries');

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
    lcp: browserMetrics.lcpMs !== null && browserMetrics.lcpMs <= 2500,
    js: jsGzipBytes <= 150 * 1024,
    css: cssGzipBytes <= 30 * 1024,
    requests: browserMetrics.requestCount <= 50
  },
  diagnostics: {
    fcpWithin1800Ms: browserMetrics.fcpMs !== null && browserMetrics.fcpMs <= 1800
  }
};

await mkdir('.gstack/benchmark-reports', { recursive: true });
await writeFile('.gstack/benchmark-reports/latest.json', JSON.stringify(metrics, null, 2));
process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
previewProcess?.kill();

if (Object.values(metrics.budgets).some((passed) => !passed)) process.exitCode = 1;
