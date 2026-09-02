import { expect, test } from '@playwright/test';

test('auth, crest, station rules, and validation recovery are complete', async ({ page }, testInfo) => {
  await page.goto('/');

  const crest = page.getByRole('img', { name: '國立東華大學校徽' }).first();
  await expect(crest).toBeVisible();
  expect(await crest.evaluate((image) => /** @type {HTMLImageElement} */ (image).naturalWidth)).toBeGreaterThan(0);

  await page.getByRole('tab', { name: '註冊' }).click();
  await expect(page.getByRole('heading', { name: '第一次使用' })).toBeVisible();
  await expect(page.getByRole('button', { name: '使用 Google 帳號建立帳號' })).toBeDisabled();

  await page.getByRole('tab', { name: '登入' }).click();
  await page.getByRole('button', { name: '登入遇到問題？' }).click();
  await expect(page.getByText('展示模式不使用密碼；重設展示資料後可重新開始。')).toBeVisible();
  await page.getByRole('button', { name: '進入展示流程' }).click();

  const visibleMapText = await page.locator('.route-map text').allTextContents();
  for (const internalLabel of ['P', 'HSS', 'LIBRARY', 'ADMIN']) {
    expect(visibleMapText).not.toContain(internalLabel);
  }

  await page.locator('input[name="pickup-location"][value="LIBRARY"]').check();
  if (testInfo.project.name === 'chromium-mobile') {
    const continueBox = await page.getByRole('button', { name: '繼續填寫投遞資料' }).boundingBox();
    const mapBox = await page.locator('.map-panel').boundingBox();
    expect(continueBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(mapBox?.y ?? Number.NEGATIVE_INFINITY);
  }
  await page.getByRole('button', { name: '繼續填寫投遞資料' }).click();
  await expect(page.getByRole('heading', { name: '填寫投遞資料' })).toBeFocused();
  await expect(page.locator('.skip-link')).not.toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('input[name="dropoff-location"][value="LIBRARY"]')).toBeDisabled();
  await expect(page.locator('input[name="dropoff-location"][value="HSS1"]')).toBeDisabled();
  await expect(page.getByText('灰色站點的路線尚未完成示教，暫不提供選取。')).toBeVisible();
  await expect(page.locator('.route-overview')).not.toHaveAttribute('open', '');
  await expect(page.locator('.route-overview .route-map')).toBeHidden();
  const firstFieldBox = await page.getByLabel('收件人姓名').boundingBox();
  expect(firstFieldBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
  await page.locator('input[name="dropoff-location"][value="ADMIN"]').check();
  await page.getByRole('button', { name: '檢查並前往確認' }).click();

  // 表單少填不是當機。橫幅只說要修哪裡，代碼留給真的需要回報的錯誤。
  await expect(page.getByRole('alert')).toContainText('請修正標示的欄位');
  await expect(page.getByRole('alert')).not.toContainText('DELIVERY_VALIDATION_FAILED');
  await expect(page.getByLabel('收件人姓名')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('台灣手機號碼')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('body')).not.toContainText('null');
});
