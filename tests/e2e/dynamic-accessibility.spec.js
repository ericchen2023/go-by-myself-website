import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function expectNoAxeViolations(page) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter(({ impact }) => ['serious', 'critical'].includes(impact ?? ''));
  expect(violations).toEqual([]);
}

test('dynamic sender and recipient states keep the accessibility baseline', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: '進入展示流程' }).click();
  await expectNoAxeViolations(page);

  await page.locator('input[name="pickup-location"][value="LIBRARY"]').check();
  await page.getByRole('button', { name: '繼續填寫投遞資料' }).click();
  await page.locator('input[name="dropoff-location"][value="ADMIN"]').check();
  await page.getByLabel('收件人姓名').fill('展示收件人');
  await page.getByLabel('台灣手機號碼').fill('0912345678');
  // 取件碼寄到這個信箱，所以它現在是必填。
  await page.getByLabel('Email', { exact: true }).fill('recipient@example.com');
  await expectNoAxeViolations(page);

  await page.getByRole('button', { name: '檢查並前往確認' }).click();
  await page.getByRole('button', { name: '確認投遞' }).click();
  await page.getByRole('button', { name: '呼叫車輛' }).click();
  await page.getByRole('heading', { name: '確認車輛後再開艙' }).waitFor({ timeout: 8_000 });
  await page.getByRole('button', { name: '開啟置物艙' }).click();
  await page.getByRole('heading', { name: '請放入物品' }).waitFor();
  await page.getByRole('button', { name: '確認已放入並關門' }).click();
  await page.getByRole('heading', { name: '取件憑證已啟用' }).waitFor({ timeout: 8_000 });
  await expectNoAxeViolations(page);

  await page.getByRole('link', { name: '前往收件人取件頁' }).click();
  await expectNoAxeViolations(page);
  await page.getByLabel('一次性人類取件碼').fill('NDHU 4826');
  await page.getByRole('button', { name: '驗證並開啟收件艙' }).click();
  await page.getByRole('heading', { name: '艙門已確認開啟' }).waitFor();
  await expectNoAxeViolations(page);
});

test('200 and 400 percent equivalent reflow does not overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'One Chromium project is sufficient for CSS reflow geometry.');

  for (const width of [640, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.getByRole('button', { name: '進入展示流程' }).click();
    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  }
});

test('reduced motion preference suppresses nonessential transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const motion = await page.getByRole('button', { name: '進入展示流程' }).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      transitionDuration: Number.parseFloat(style.transitionDuration),
    };
  });

  expect(motion.matches).toBe(true);
  expect(motion.transitionDuration).toBeLessThanOrEqual(0.001);
});
