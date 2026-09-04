import { el, ndhuEmblem, projectMark } from './dom.js';
import { STEP_NAMES, deliveryStatusCopy } from '../domain/presentation.js';

/** @param {{banner: {className:string,copy:string}, session: {displayName: string,roles?:string[]}|null, hasDelivery: boolean, navigate: (path: string) => void, onSignOut: () => void}} options */
export function siteHeader(options) {
  return el('header', { className: 'site-header' },
    el('div', { className: 'site-header__inner' },
      el('a', { className: 'brand-link', href: '/', onclick: (event) => { event.preventDefault(); options.navigate('/'); } },
        ndhuEmblem('header'),
        el('span', { className: 'brand-copy' },
          el('span', { className: 'brand-code' }, '校園固定路線 · 學生專題'),
          el('strong', {}, 'go by myself'),
          el('small', {}, '校園智慧投遞學生專題')
        )
      ),
      el('nav', { className: 'site-nav', 'aria-label': '主要導覽' },
        options.hasDelivery ? el('a', { href: '/delivery/current', onclick: (event) => { event.preventDefault(); options.navigate('/delivery/current'); } }, '目前投遞') : null,
        options.session?.roles?.includes('operator') ? el('a', { href: '/operator/route-validation', onclick: (event) => { event.preventDefault(); options.navigate('/operator/route-validation'); } }, '路線驗證') : null,
        el('a', { href: '/support', onclick: (event) => { event.preventDefault(); options.navigate('/support'); } }, '協助'),
        options.session ? el('button', { className: 'button button--ghost button--small', type: 'button', onclick: options.onSignOut }, '登出') : null
      )
    ),
    el('div', { className: options.banner.className, role: 'status' }, options.banner.copy)
  );
}

export function siteFooter() {
  return el('footer', { className: 'site-footer' },
    el('div', { className: 'site-footer__inner' },
      el('p', {}, 'go by myself｜國立東華大學校園智慧投遞學生專題'),
      el('nav', { 'aria-label': '頁尾導覽' },
        el('a', { href: '/privacy' }, '隱私說明'),
        el('a', { href: '/support' }, '協助與專案狀態')
      )
    )
  );
}

/** @param {number} current */
export function stepper(current) {
  const clamped = Math.max(1, Math.min(8, current));
  return el('nav', { className: 'stepper', 'aria-label': '投遞進度' },
    el('div', { className: 'stepper-compact' },
      el('span', {}, `步驟 ${clamped} / 8 · ${STEP_NAMES[clamped - 1]}`),
      el('progress', { max: '8', value: String(clamped), 'aria-label': `目前為第 ${clamped} 步，共 8 步` })
    ),
    el('ol', { className: 'stepper-full' },
      ...STEP_NAMES.map((name, index) => {
        const step = index + 1;
        const state = step < clamped ? 'is-complete' : step === clamped ? 'is-current' : '';
        return el('li', { className: state, 'aria-current': step === clamped ? 'step' : null },
          el('span', { className: 'step-number' }, step < clamped ? '✓' : String(step)),
          el('span', { className: 'step-label' }, name)
        );
      })
    )
  );
}

/** @param {{code: string, message: string, retryable?: boolean, fieldErrors?: Record<string, string>|null}|null} error @param {() => void} [onDismiss] */
export function errorBanner(error, onDismiss) {
  if (!error) return null;
  // A form the reader can fix is not a fault they need to report. Leading with
  // a code like DELIVERY_VALIDATION_FAILED reads as a crash, and the fields
  // already carry their own messages; keep the code for everything else, where
  // it is the thing support will ask for.
  const fieldCount = Object.keys(error.fieldErrors ?? {}).length;
  return el('div', { className: 'alert alert--danger', role: 'alert' },
    el('div', {},
      fieldCount ? null : el('strong', {}, error.code),
      el('p', {}, error.message),
      error.retryable && !fieldCount ? el('small', {}, '此操作可用相同資料安全重試。') : null
    ),
    onDismiss ? el('button', { className: 'icon-button', type: 'button', 'aria-label': '關閉錯誤訊息', onclick: onDismiss }, '×') : null
  );
}

/** @param {{status: string, telemetry: {connectivity?: string, positionQuality?: string}}} state */
export function statusHero(state) {
  const copy = deliveryStatusCopy(state.status, state.telemetry);
  return el('section', { className: `status-hero status-hero--${copy.tone}`, 'aria-labelledby': 'status-title' },
    el('p', { className: 'eyebrow' }, copy.eyebrow),
    el('h1', { id: 'status-title' }, copy.title),
    copy.metrics ? statusMetrics(copy.metrics) : null,
    el('p', { className: 'status-detail' }, copy.detail)
  );
}

/**
 * 行程進度與預計抵達。
 *
 * 這兩個是這一頁最常被看的值，所以給它們自己的欄位與尺寸，而不是混在一段
 * 敘述裡讓人用讀的把數字找出來。還沒有估算時就說「還在估算」—— 留白會讓人
 * 以為畫面壞了，而編一個數字比留白更糟。
 *
 * @param {{progressPercent: number|null, progressLabel: string, eta: string|null, etaLabel: string}} metrics
 */
function statusMetrics(metrics) {
  const wrapper = el('div', { className: 'status-metrics' });
  if (metrics.progressPercent !== null) {
    wrapper.append(el('div', { className: 'status-metric' },
      el('span', { className: 'status-metric-label' }, metrics.progressLabel),
      el('strong', { className: 'status-metric-value' }, `${metrics.progressPercent}%`),
      el('div', {
        className: 'status-metric-bar',
        role: 'progressbar',
        'aria-label': metrics.progressLabel,
        'aria-valuenow': String(metrics.progressPercent),
        'aria-valuemin': '0',
        'aria-valuemax': '100'
      }, el('span', { style: `width:${metrics.progressPercent}%` }))
    ));
  }
  wrapper.append(el('div', { className: 'status-metric' },
    el('span', { className: 'status-metric-label' }, metrics.etaLabel),
    el('strong', { className: 'status-metric-value' }, metrics.eta ?? '估算中')
  ));
  return wrapper;
}

/** @param {string} label @param {string} value */
export function summaryItem(label, value) {
  return el('div', { className: 'summary-item' }, el('dt', {}, label), el('dd', {}, value || '—'));
}

/** @param {string} id @param {string} label @param {string} [error] */
export function fieldShell(id, label, error) {
  const wrapper = el('div', { className: `field${error ? ' field--error' : ''}` });
  wrapper.append(el('label', { htmlFor: id }, label));
  return {
    wrapper,
    describedBy: error ? `${id}-error` : undefined,
    appendError() {
      if (error) wrapper.append(el('p', { id: `${id}-error`, className: 'field-error' }, error));
    }
  };
}

/** @param {string} title @param {string} detail */
export function emptyState(title, detail) {
  return el('section', { className: 'empty-state' },
    projectMark('P'),
    el('h1', {}, title),
    el('p', {}, detail)
  );
}
