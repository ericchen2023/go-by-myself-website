import { el } from '../app/dom.js';

export const googleDisabled = false;
export const googleHelp = '';
export const recoveryText = 'Google 帳號請使用 Google 或東華帳號復原；專題登入連結則可重新寄送。';
export const supportCopy = '聯絡專案指定的協助窗口時，請一併提供畫面上的操作編號。';
export const dispatchIntro = '按下「呼叫車輛」後，系統會確認車輛可用並建立派車要求。';
export const cancelledCopy = '本次投遞已取消；物品位置與後續處理由現場人員的處理紀錄確認。';
export const modePrivacyLead = '正式試行前，必須完成資料告知、保留政策與權利申請流程，並由校方和隱私管理人員確認。';

export function modeBanner() {
  return { className: 'project-banner', copy: '學生專題，非 NDHU 官方服務' };
}

export function recipientBadge() { return null; }

export function modeSupportSection() {
  return el('section', {},
    el('h2', {}, '測試環境與實機整合'),
    el('p', {}, '目前真實車輛功能維持關閉；所有操作必須先通過受信任的控制服務，瀏覽器不會直接控制車輛。')
  );
}

/** @param {{adapter:any,navigate:(path:string)=>void,run:(action:()=>unknown|Promise<unknown>)=>void}} options */
export function authAlternative(options) {
  const emailId = 'magic-email';
  return el('details', { className: 'magic-link' },
    el('summary', {}, 'Google 暫時無法使用？改用專題登入連結'),
    el('form', { onsubmit: (event) => {
      event.preventDefault();
      const form = /** @type {HTMLFormElement} */ (event.currentTarget);
      options.run(() => options.adapter.signInWithMagicLink(String(new FormData(form).get('email') ?? '')));
    } },
    el('label', { htmlFor: emailId }, '東華 Google Workspace Email'),
    el('input', { id: emailId, name: 'email', type: 'email', autocomplete: 'email', required: true, placeholder: 'student@gms.ndhu.edu.tw' }),
    el('button', { className: 'button button--secondary button--full', type: 'submit' }, '寄送專題登入連結'))
  );
}

export function modeToolbar() { return null; }
export function credentialCallout() { return null; }
export function notificationDisclaimer() { return null; }
export function manualLoadNotice() { return null; }
export function loadButtonLabel() { return '確認已放入並關門'; }

export function pickupOpenAction() {
  return el('section', { className: 'pickup-phase pickup-phase--open', role: 'status' },
    el('h2', {}, '艙門已確認開啟'),
    el('ol', { className: 'instruction-list' }, el('li', {}, '取出你的物品。'), el('li', {}, '確認艙內沒有遺留物。'), el('li', {}, '完整關閉艙門。')),
    el('p', {}, '系統會等待車輛回報取物與關門結果；網頁不能自行把投遞標示為完成。')
  );
}
