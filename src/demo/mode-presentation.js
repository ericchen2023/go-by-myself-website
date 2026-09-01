import { el } from '../app/dom.js';
import { DEMO_SCENARIOS } from '../domain/scenarios.js';

export const homeModeCopy = Object.freeze({
  divider: '或先體驗完整流程',
  cta: '開始展示投遞',
  tag: '展示模擬',
  intro: '展示模式使用測試帳號與模擬車輛，不會寄出通知，也不會控制真實車輛。'
});
export const googleDisabled = true;
export const googleHelp = '展示模式不連接 Google，請使用下方展示帳號。';
export const recoveryText = '展示模式不使用密碼；重設展示資料後可重新開始。';
export const supportCopy = '展示環境未配置即時客服。可重設情境重新開始。';
export const dispatchIntro = '按下「呼叫車輛」後，展示車輛會沿固定路線前往放件站。';
export const cancelledCopy = '本次展示投遞已安全取消，物品保管已在模擬流程中解決。';
export const modePrivacyLead = '目前展示使用測試資料。正式試行前，下列資料政策仍需由校方與隱私管理人員確認。';

export function modeBanner() {
  return { className: 'mode-banner', copy: '展示模式：合成身份、模擬車輛、非真實通知' };
}

export function recipientBadge() {
  return el('span', { className: 'mode-pill' }, '模擬取件');
}

export function modeSupportSection() {
  return el('section', {},
    el('h2', {}, '成果展示'),
    el('p', {}, '可使用情境模擬器重設資料。展示不發送真實通知、不連 Supabase、不控制真車。')
  );
}

/** @param {{adapter:any,navigate:(path:string)=>void,run:(action:()=>unknown|Promise<unknown>)=>Promise<boolean>,setNotice:(message:string)=>void}} options */
export function authAlternative(options) {
  return el('button', {
    className: 'button button--signal button--full',
    type: 'button',
    onclick: () => options.run(() => {
      options.adapter.authenticateGuest();
      options.navigate('/delivery/new');
    })
  }, '進入展示流程');
}

/** @param {any} state @param {any} adapter @param {(path:string)=>void} navigate */
export function modeToolbar(state, adapter, navigate) {
  return el('aside', { className: 'demo-toolbar', 'aria-label': '展示情境控制' },
    el('div', {}, el('strong', {}, '展示情境'), el('small', {}, '切換情境會清除這次的展示資料。')),
    el('label', { className: 'sr-only', htmlFor: 'scenario-select' }, '選擇展示情境'),
    el('select', {
      id: 'scenario-select',
      value: state.scenario,
      onchange: (event) => {
        const select = /** @type {HTMLSelectElement} */ (event.currentTarget);
        adapter.setScenario(select.value);
        navigate('/');
      }
    }, ...DEMO_SCENARIOS.map((scenario) => el('option', { value: scenario.id, selected: state.scenario === scenario.id }, scenario.label))),
    el('button', { className: 'button button--ghost button--small', type: 'button', onclick: () => { adapter.reset(); navigate('/'); } }, '重設展示')
  );
}

/** @param {'sender'|'recipient'} audience */
export function credentialCallout(audience) {
  return el('div', { className: 'demo-code-callout' },
    el('span', {}, audience === 'recipient' ? '成果展示專用取件碼' : '展示取件碼'),
    el('strong', {}, 'NDHU 4826'),
    el('small', {}, 'NDHU 4826 僅供成果展示。正式版本會使用較長的一次性取件碼。')
  );
}

export function notificationDisclaimer() {
  return el('small', {}, '這是展示用通知紀錄，不會真的寄出簡訊或 Email。');
}

/** @param {()=>void} onConfirm */
export function pickupOpenAction(onConfirm) {
  return el('section', { className: 'pickup-phase pickup-phase--open' },
    el('h2', {}, '艙門已確認開啟'),
    el('ol', { className: 'instruction-list' }, el('li', {}, '取出你的物品。'), el('li', {}, '確認艙內沒有遺留物。'), el('li', {}, '完整關閉艙門。')),
    el('button', { className: 'button button--primary button--full', type: 'button', onclick: onConfirm }, '模擬物品已取出並關門')
  );
}

/** @param {string|null} scenario */
export function manualLoadNotice(scenario) {
  return scenario === 'compartment-sensor-missing'
    ? el('div', { className: 'alert alert--warning' }, '此展示情境無法讀取物品感測器。使用人工確認時，系統會留下操作紀錄。')
    : null;
}

/** @param {string|null} scenario */
export function loadButtonLabel(scenario) {
  return scenario === 'compartment-sensor-missing' ? '人工確認已放入並關門' : '確認已放入並關門';
}

/**
 * 展示模式是一個人走完寄件與收件兩個角色，所以這裡留一條路過去 —— 否則展示
 * 會斷在「等待收件人」而沒有收件人可以等。
 * @param {string} publicRef
 * @param {{compact?: boolean}} [options]
 */
export function recipientHandoff(publicRef, options = {}) {
  return el('a', {
    className: options.compact ? 'button button--secondary' : 'button button--primary',
    href: `/pickup/${publicRef}`
  }, '前往收件人取件頁');
}
