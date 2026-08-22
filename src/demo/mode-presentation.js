import { el } from '../app/dom.js';
import { DEMO_SCENARIOS } from '../domain/scenarios.js';

export const googleDisabled = true;
export const googleHelp = '展示 build 不載入 Google OAuth。請使用下方合成身份。';
export const recoveryText = '展示模式不使用密碼；重設展示資料後可重新開始。';
export const supportCopy = '展示環境未配置即時客服。可重設情境重新開始。';
export const dispatchIntro = '尚未派車。展示模式會以固定路線與 deterministic 時序模擬車輛。';
export const cancelledCopy = '本次展示投遞已安全取消，物品保管已在模擬流程中解決。';
export const modePrivacyLead = '目前成果展示使用合成資料。以下是 production pilot 前必須落實並經校方／隱私 owner 審查的預設政策。';

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

/** @param {{adapter:any,navigate:(path:string)=>void,run:(action:()=>unknown|Promise<unknown>)=>void}} options */
export function authAlternative(options) {
  return el('button', {
    className: 'button button--secondary button--full',
    type: 'button',
    onclick: () => options.run(() => {
      options.adapter.authenticateGuest();
      options.navigate('/delivery/new');
    })
  }, '以展示身份開始八步流程');
}

/** @param {any} state @param {any} adapter @param {(path:string)=>void} navigate */
export function modeToolbar(state, adapter, navigate) {
  return el('aside', { className: 'demo-toolbar', 'aria-label': '展示情境控制' },
    el('div', {}, el('strong', {}, '情境模擬器'), el('small', {}, '變更情境會清除本次 session 展示資料。')),
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
    el('small', {}, audience === 'recipient' ? '清楚標示的合成碼；不代表 production 安全設計。' : '僅用於展示；production 不使用四位碼。')
  );
}

export function notificationDisclaimer() {
  return el('small', {}, '這是 truthful mock event，不會發送 SMS 或 email。');
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
    ? el('div', { className: 'alert alert--warning' }, '展示情境：item sensor 不可用，以下操作會留下「人工確認」audit evidence。')
    : null;
}

/** @param {string|null} scenario */
export function loadButtonLabel(scenario) {
  return scenario === 'compartment-sensor-missing' ? '人工確認已放入並關門' : '確認已放入並關門';
}
