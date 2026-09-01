// 這裡的等待都是在等 demo 的計時器鏈（路線動畫每段 160ms，狀態轉換 550-650ms）。
// timeout 放寬到 15 秒不是在遷就慢：畫面一出現就會往下走，寬鬆只會擋掉機器忙碌
// 時的假失敗。
import { expect, test } from '@playwright/test';

test('complete deterministic sender and recipient demo', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '校園自走車投遞網站' })).toBeVisible();
  await expect(page.getByText('學生專題，非 NDHU 官方服務').first()).toBeVisible();
  await page.getByRole('button', { name: '進入展示流程' }).click();

  await expect(page.locator('.stepper')).toContainText('放件地點');
  await page.locator('input[name="pickup-location"][value="LIBRARY"]').check();
  await page.getByRole('button', { name: '繼續填寫投遞資料' }).click();

  await page.locator('input[name="dropoff-location"][value="ADMIN"]').check();
  await page.getByLabel('收件人姓名').fill('展示收件人');
  await page.getByLabel('台灣手機號碼').fill('0912345678');
  // 取件碼寄到這個信箱，所以它現在是必填。
  await page.getByLabel('Email', { exact: true }).fill('recipient@example.com');
  await page.getByLabel('物品類型').selectOption('document');
  await page.getByRole('button', { name: '檢查並前往確認' }).click();

  await expect(page.getByRole('heading', { name: '確認投遞內容' })).toBeVisible();
  await page.getByRole('button', { name: '確認投遞' }).click();
  await expect(page.getByRole('heading', { name: '準備呼叫車輛' })).toBeVisible();
  await page.getByRole('button', { name: '呼叫車輛' }).click();
  await expect(page.getByRole('heading', { name: '確認車輛後再開艙' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('body')).not.toContainText('狀態版本');

  await page.getByRole('button', { name: '開啟置物艙' }).click();
  await expect(page.getByRole('heading', { name: '請放入物品' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '確認已放入並關門' }).click();
  await expect(page.getByRole('heading', { name: '取件憑證已啟用' })).toBeVisible({ timeout: 15_000 });
  // 取件碼是收件人的鑰匙：信寄得出去時，寄件人畫面上不該出現它。
  await expect(page.getByText('NDHU 4826', { exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: '前往收件人取件頁' }).click();
  await expect(page.getByRole('heading', { name: '確認站點與車輛後取件' })).toBeVisible();
  await expect(page.getByText('NDHU 4826', { exact: true })).toBeVisible();
  await page.getByLabel('一次性人類取件碼').fill('NDHU 4826');
  await page.getByRole('button', { name: '驗證並開啟收件艙' }).click();
  await expect(page.getByRole('heading', { name: '艙門已確認開啟' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '模擬物品已取出並關門' }).click();
  await expect(page.getByRole('heading', { name: '取件完成' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: '返回寄件進度' }).click();
  await expect(page.locator('.stepper')).toContainText('步驟 8 / 8');
  await expect(page.getByRole('heading', { name: '物品已由收件人取走' })).toBeVisible();
});

test('arrival at dropoff never renders completed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '進入展示流程' }).click();
  await page.locator('input[name="pickup-location"][value="LIBRARY"]').check();
  await page.getByRole('button', { name: '繼續填寫投遞資料' }).click();
  await page.locator('input[name="dropoff-location"][value="ADMIN"]').check();
  await page.getByLabel('收件人姓名').fill('展示收件人');
  await page.getByLabel('台灣手機號碼').fill('0912345678');
  // 取件碼寄到這個信箱，所以它現在是必填。
  await page.getByLabel('Email', { exact: true }).fill('recipient@example.com');
  await page.getByRole('button', { name: '檢查並前往確認' }).click();
  await page.getByRole('button', { name: '確認投遞' }).click();
  await page.getByRole('button', { name: '呼叫車輛' }).click();
  await page.getByRole('button', { name: '開啟置物艙' }).click({ timeout: 15_000 });
  await page.getByRole('button', { name: '確認已放入並關門' }).click({ timeout: 15_000 });
  await expect(page.locator('.stepper')).toContainText('步驟 7 / 8', { timeout: 15_000 });
  await expect(page.locator('.stepper')).not.toContainText('步驟 8 / 8');
  await expect(page.getByText(/尚未完成投遞|抵達不等於完成/).first()).toBeVisible();
});
