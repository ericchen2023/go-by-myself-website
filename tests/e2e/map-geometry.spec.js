import { expect, test } from '@playwright/test';

test('canonical SVG geometry supports path length and point projection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '進入展示流程' }).click();
  const geometry = await page.locator('.route-edge').evaluateAll((paths) => paths.map((path) => {
    const geometryPath = /** @type {SVGPathElement} */ (path);
    const length = geometryPath.getTotalLength();
    return [0, 0.25, 0.5, 0.75, 1].map((progress) => {
      const point = geometryPath.getPointAtLength(length * progress);
      return { progress, x: point.x, y: point.y, finite: Number.isFinite(point.x) && Number.isFinite(point.y) };
    });
  }));
  expect(geometry.flat().every((point) => point.finite)).toBe(true);
  await expect(page.locator('.map-stop')).toHaveCount(4);
  await expect(page.locator('.origin-capsule')).toHaveCount(0);
  const visibleMapText = await page.locator('.route-map text').allTextContents();
  expect(visibleMapText).not.toContain('P');
  expect(visibleMapText).not.toContain('HSS');
  expect(visibleMapText).not.toContain('LIBRARY');
  expect(visibleMapText).not.toContain('ADMIN');
});

test('vehicle marker advances along the active canonical route', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '進入展示流程' }).click();
  await page.locator('input[name="pickup-location"][value="LIBRARY"]').check();
  await page.getByRole('button', { name: '繼續填寫投遞資料' }).click();
  await page.locator('input[name="dropoff-location"][value="ADMIN"]').check();
  await page.getByLabel('收件人姓名').fill('展示收件人');
  await page.getByLabel('台灣手機號碼').fill('0912345678');
  await page.getByRole('button', { name: '檢查並前往確認' }).click();
  await page.getByRole('button', { name: '確認投遞' }).click();
  await page.getByRole('button', { name: '呼叫車輛' }).click();

  const marker = page.locator('.vehicle-marker');
  await expect(marker).toBeVisible();
  const firstTransform = await marker.getAttribute('transform');
  await page.waitForTimeout(450);
  const nextTransform = await page.locator('.vehicle-marker').getAttribute('transform');
  expect(nextTransform).not.toBe(firstTransform);
  const activeEdges = page.locator('.route-edge.is-active');
  expect(await activeEdges.count()).toBeGreaterThan(0);
  expect(await activeEdges.first().evaluate((path) => getComputedStyle(path).stroke)).not.toBe('none');
  await expect(page.locator('.journey-segment--remaining')).not.toHaveCount(0);
  await expect(page.locator('.journey-segment--traveled')).not.toHaveCount(0);
  await expect(page.locator('.status-actions')).not.toContainText('null');
});
