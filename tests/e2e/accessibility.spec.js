import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const route of ['/', '/privacy', '/support']) {
  test(`axe baseline has no serious or critical violations on ${route}`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page }).analyze();
    const violations = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''));
    expect(violations).toEqual([]);
  });
}

test('keyboard can select a map stop and continue', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '以展示身份開始八步流程' }).click();
  const firstMapStop = page.locator('.map-stop[tabindex="0"]');
  await firstMapStop.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '繼續填寫投遞資料' })).toBeEnabled();
});

test('page has no horizontal overflow at required narrow widths', async ({ page }) => {
  for (const width of [320, 375, 390, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  }
});

