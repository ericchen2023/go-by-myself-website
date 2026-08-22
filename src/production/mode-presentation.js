import { el } from '../app/dom.js';

export const googleDisabled = false;
export const googleHelp = '';
export const recoveryText = 'Google 帳號請使用 Google／東華帳號復原；magic link 帳號可重新寄送登入連結。';
export const supportCopy = '請使用專案指定的 support 管道，並提供 request reference。';
export const dispatchIntro = '尚未派車。送出後會由可信任 control plane 建立 reservation 與命令 outbox。';
export const cancelledCopy = '本次投遞已取消；物品保管位置與後續處置以 operator 紀錄為準。';
export const modePrivacyLead = '正式 pilot 前必須完成資料告知、保留政策與權利申請流程，並經校方／隱私 owner 審查。';

export function modeBanner() {
  return { className: 'project-banner', copy: '學生專題，非 NDHU 官方服務' };
}

export function recipientBadge() { return null; }

export function modeSupportSection() {
  return el('section', {},
    el('h2', {}, 'Staging 與實機整合'),
    el('p', {}, '目前 robot capability 維持關閉；操作只能透過受信任 control plane，瀏覽器不會直接控制車輛。')
  );
}

/** @param {{adapter:any,navigate:(path:string)=>void,run:(action:()=>unknown|Promise<unknown>)=>void}} options */
export function authAlternative(options) {
  const emailId = 'magic-email';
  return el('details', { className: 'magic-link' },
    el('summary', {}, 'Google 暫時無法使用？改用專題 magic link'),
    el('form', { onsubmit: (event) => {
      event.preventDefault();
      const form = /** @type {HTMLFormElement} */ (event.currentTarget);
      options.run(() => options.adapter.signInWithMagicLink(String(new FormData(form).get('email') ?? '')));
    } },
    el('label', { htmlFor: emailId }, '東華 Google Workspace email'),
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
    el('p', {}, '系統會等待車端的取物與關門 evidence；網頁不能自行宣稱完成。')
  );
}
