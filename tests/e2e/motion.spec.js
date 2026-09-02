import { expect, test } from '@playwright/test';

async function beginDispatch(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '進入展示流程' }).click();
  await page.locator('input[name="pickup-location"][value="LIBRARY"]').check();
  await page.getByRole('button', { name: '繼續填寫投遞資料' }).click();
  await page.locator('input[name="dropoff-location"][value="ADMIN"]').check();
  await page.getByLabel('收件人姓名').fill('動畫測試收件人');
  await page.getByLabel('台灣手機號碼').fill('0912345678');
  await page.getByLabel('Email').fill('motion.recipient@example.com');
  await page.getByLabel('物品類型').selectOption('document');
  await page.getByRole('button', { name: '檢查並前往確認' }).click();
  await expect(page.getByRole('heading', { name: '確認投遞內容' })).toBeVisible();
  await page.getByRole('button', { name: '確認投遞' }).click();
  await page.getByRole('button', { name: '呼叫車輛' }).click();
}

test('normal motion is deliberate, finite, and follows the live route', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
  const previewMotion = page.locator('.preview-vehicle animateMotion');
  await expect(previewMotion).toHaveAttribute('dur', '4.6s');
  await expect(previewMotion).toHaveAttribute('repeatCount', '1');

  await beginDispatch(page);
  const mapBox = await page.locator('.status-primary .route-map').boundingBox();
  expect(mapBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(await page.evaluate(() => innerHeight));

  const marker = page.locator('.vehicle-marker');
  await expect(marker).toBeVisible();
  await expect(marker).toHaveClass(/is-moving/);
  const firstTransform = await marker.getAttribute('transform');
  await expect.poll(() => marker.getAttribute('transform'), { timeout: 2_000 }).not.toBe(firstTransform);

  const routeFlow = page.locator('.journey-segment--flow').first();
  await expect(routeFlow).toBeVisible();
  const routeFlowMotion = await routeFlow.evaluate((element) => {
    const style = getComputedStyle(element);
    return { name: style.animationName, iterations: style.animationIterationCount };
  });
  expect(routeFlowMotion).toEqual({ name: 'route-flow', iterations: '4' });

  const unsafeTransitions = await page.locator('body *').evaluateAll((elements) => elements.filter((element) => {
    const style = getComputedStyle(element);
    return style.transitionProperty.split(',').map((value) => value.trim()).includes('all')
      && style.transitionDuration.split(',').some((value) => Number.parseFloat(value) > 0);
  }).length);
  expect(unsafeTransitions).toBe(0);
  await expect(page.getByRole('heading', { name: '確認車輛後再開艙' })).toBeVisible({ timeout: 8_000 });
});
