import { describe, expect, it } from 'vitest';
import { maskPhone, normalizeTaiwanMobile, validateDeliveryInput } from '../../src/domain/validation.js';

const valid = {
  pickupCode: 'LIBRARY',
  dropoffCode: 'ADMIN',
  recipientName: ' 林小華 ',
  recipientPhone: '0912-345-678',
  recipientEmail: 'TEST@EXAMPLE.COM',
  itemType: 'document',
  note: ' 測試文件 '
};

describe('shared input validation', () => {
  it('normalizes Taiwan mobile numbers to E.164', () => {
    expect(normalizeTaiwanMobile('0912 345 678')).toBe('+886912345678');
    expect(normalizeTaiwanMobile('+886912345678')).toBe('+886912345678');
    expect(maskPhone('+886912345678')).toBe('0912•••678');
  });

  it('NFC-normalizes, trims, and lowercases email', () => {
    const result = validateDeliveryInput(valid);
    expect(result.errors).toEqual({});
    expect(result.value.recipientName).toBe('林小華');
    expect(result.value.recipientEmail).toBe('test@example.com');
    expect(result.value.note).toBe('測試文件');
  });

  it('requires an email, because that is where the pickup code goes', () => {
    const result = validateDeliveryInput({ ...valid, recipientEmail: '' });
    expect(result.errors.recipientEmail).toContain('取件碼會寄到這裡');
  });

  it('still refuses an address that could not receive anything', () => {
    const result = validateDeliveryInput({ ...valid, recipientEmail: 'not-an-address' });
    expect(result.errors.recipientEmail).toBeTruthy();
  });

  it('rejects identical stops and invalid contact data', () => {
    const result = validateDeliveryInput({ ...valid, dropoffCode: 'LIBRARY', recipientPhone: '123', recipientName: '' });
    expect(result.errors.dropoffCode).toMatch(/不能/);
    expect(result.errors.recipientPhone).toMatch(/台灣手機/);
    expect(result.errors.recipientName).toMatch(/1–50/);
  });

  it('treats markup as inert text and enforces maximum note length', () => {
    const result = validateDeliveryInput({ ...valid, recipientName: '<img src=x onerror=alert(1)>', note: '字'.repeat(301) });
    expect(result.value.recipientName).toContain('<img');
    expect(result.errors.note).toMatch(/300/);
  });
});
