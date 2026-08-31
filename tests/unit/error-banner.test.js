import { expect, test } from 'vitest';
import { errorBanner } from '../../src/app/components.js';

test('leads with the code for a fault the reader would have to report', () => {
  const banner = errorBanner({ code: 'VEHICLE_UNAVAILABLE', message: '目前沒有可派遣的車輛。', retryable: true });

  expect(banner?.querySelector('strong')?.textContent).toBe('VEHICLE_UNAVAILABLE');
  expect(banner?.textContent).toContain('目前沒有可派遣的車輛。');
  expect(banner?.textContent).toContain('可用相同資料安全重試');
});

test('drops the code when the reader just has fields to fix', () => {
  const banner = errorBanner({
    code: 'DELIVERY_VALIDATION_FAILED',
    message: '請修正表單欄位。',
    retryable: false,
    fieldErrors: { recipientName: '收件人姓名需為 1–50 個字。', itemType: '請選擇物品類型。' }
  });

  // The fields carry their own messages; a code here reads as a crash.
  expect(banner?.querySelector('strong')).toBeNull();
  expect(banner?.textContent).toContain('請修正表單欄位。');
  expect(banner?.textContent).not.toContain('DELIVERY_VALIDATION_FAILED');
});

test('treats an empty field-error map as a fault, not a form problem', () => {
  const banner = errorBanner({ code: 'DELIVERY_CONFLICT', message: '資料已被更新。', fieldErrors: {} });

  expect(banner?.querySelector('strong')?.textContent).toBe('DELIVERY_CONFLICT');
});

test('renders nothing without an error', () => {
  expect(errorBanner(null)).toBeNull();
});
