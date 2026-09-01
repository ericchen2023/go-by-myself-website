import { DomainError } from './errors.js';

/** @type {ReadonlyArray<readonly [string, string]>} */
export const ITEM_TYPES = Object.freeze([
  ['document', '文件'],
  ['book', '書籍'],
  ['small_parcel', '小型包裹'],
  ['equipment', '器材']
]);

const itemTypeValues = new Set(ITEM_TYPES.map(([value]) => value));

/** @param {unknown} value */
export function normalizeText(value) {
  return String(value ?? '').normalize('NFC').trim();
}

/** @param {unknown} value */
export function normalizeTaiwanMobile(value) {
  const compact = normalizeText(value).replace(/[\s()-]/g, '');
  if (/^09\d{8}$/.test(compact)) return `+886${compact.slice(1)}`;
  if (/^\+8869\d{8}$/.test(compact)) return compact;
  return null;
}

/** @param {string} phone */
export function formatTaiwanMobile(phone) {
  if (!/^\+8869\d{8}$/.test(phone)) return phone;
  const local = `0${phone.slice(4)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

/** @param {string} phone */
export function maskPhone(phone) {
  const formatted = formatTaiwanMobile(phone).replace(/\s/g, '');
  return formatted.length >= 10 ? `${formatted.slice(0, 4)}•••${formatted.slice(-3)}` : '未提供';
}

/** @param {string} email */
export function maskEmail(email) {
  if (!email) return '未提供';
  const [local, domain] = email.split('@');
  if (!domain) return '格式無效';
  return `${local.slice(0, 1)}•••@${domain}`;
}

/** @param {string} value */
function characterLength(value) {
  return Array.from(value).length;
}

/**
 * @param {Record<string, unknown>} input
 * @returns {{value: ValidatedDeliveryInput, errors: Record<string, string>}}
 */
export function validateDeliveryInput(input) {
  const pickupCode = normalizeText(input.pickupCode);
  const dropoffCode = normalizeText(input.dropoffCode);
  const recipientName = normalizeText(input.recipientName);
  const phone = normalizeTaiwanMobile(input.recipientPhone);
  const recipientEmail = normalizeText(input.recipientEmail).toLowerCase();
  const itemType = normalizeText(input.itemType);
  const note = normalizeText(input.note);
  /** @type {Record<string, string>} */
  const errors = {};

  if (!pickupCode) errors.pickupCode = '請選擇放置物品地點。';
  if (!dropoffCode) errors.dropoffCode = '請選擇收件地點。';
  if (pickupCode && dropoffCode && pickupCode === dropoffCode) {
    errors.dropoffCode = '收件地點不能和放件地點相同。';
  }
  if (characterLength(recipientName) < 1 || characterLength(recipientName) > 50) {
    errors.recipientName = '收件人姓名需為 1–50 個字。';
  }
  if (!phone) errors.recipientPhone = '請輸入有效的台灣手機號碼，例如 0912345678。';
  // 取件碼寄到這個信箱，沒有它收件人就取不了件 —— 所以它是必填，不是備援。
  if (!recipientEmail) errors.recipientEmail = '請輸入收件人 email，取件碼會寄到這裡。';
  else if (recipientEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    errors.recipientEmail = '請輸入有效的 email。';
  }
  if (!itemTypeValues.has(itemType)) errors.itemType = '請選擇物品類型。';
  if (characterLength(note) > 300) errors.note = '備註最多 300 個字。';

  return {
    value: {
      pickupCode,
      dropoffCode,
      recipientName,
      recipientPhone: phone ?? '',
      recipientEmail,
      itemType,
      note
    },
    errors
  };
}

/** @param {Record<string, unknown>} input */
export function assertValidDeliveryInput(input) {
  const result = validateDeliveryInput(input);
  if (Object.keys(result.errors).length) {
    throw new DomainError('DELIVERY_VALIDATION_FAILED', '請修正表單欄位。', {
      fieldErrors: result.errors
    });
  }
  return result.value;
}

/**
 * @typedef {object} ValidatedDeliveryInput
 * @property {string} pickupCode
 * @property {string} dropoffCode
 * @property {string} recipientName
 * @property {string} recipientPhone
 * @property {string} recipientEmail
 * @property {string} itemType
 * @property {string} note
 */
