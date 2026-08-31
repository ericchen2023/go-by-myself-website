import { expect, test } from '@playwright/test';

test.describe('protected production-shaped staging', () => {
  test.skip(!process.env.E2E_BASE_URL, 'E2E_BASE_URL is required for hosted staging checks');

  test('serves health and the production shell through deployment protection', async ({ page, request }) => {
    const health = await request.get('/health.json');
    expect(health.ok()).toBe(true);
    await expect(health.json()).resolves.toMatchObject({ status: 'ok' });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: '校園自走車投遞網站' })).toBeVisible();
    await expect(page.getByRole('img', { name: '國立東華大學校徽' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '使用 Google 帳號登入' })).toBeEnabled();
    await expect(page.getByText('整合測試環境使用獨立資料庫與受信任控制服務').first()).toBeVisible();
    await expect(page.getByRole('button', { name: '進入展示流程' })).toHaveCount(0);
  });
});
