import { el } from '../app/dom.js';
import { runtimeConfig } from '../config/runtime.js';

export const homeModeCopy = Object.freeze({
  divider: '',
  cta: '進入整合測試',
  tag: '整合測試',
  intro: '整合測試環境使用獨立資料庫與受信任控制服務；真實車輛功能在現場核准前維持關閉。'
});
export const googleDisabled = !runtimeConfig.googleAuthEnabled;
export const googleHelp = googleDisabled
  ? '此環境尚未完成 Google OAuth 設定，登入功能暫不可用。'
  : '網站會轉往 Google 登入；首次登入會自動建立專題帳號。本網站不會接收你的 Google 密碼。';
export const recoveryText = '請使用 Google 帳號復原；本網站沒有另外設定密碼。';
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

/** @param {{adapter:any,navigate:(path:string)=>void,run:(action:()=>unknown|Promise<unknown>)=>Promise<boolean>,setNotice:(message:string)=>void}} options */
export function authAlternative(options) {
  void options;
  return null;
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
