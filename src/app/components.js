import { el, ndhuEmblem, projectMark } from './dom.js';
import { STEP_NAMES, deliveryStatusCopy } from '../domain/presentation.js';

/** @param {{banner: {className:string,copy:string}, session: {displayName: string}|null, hasDelivery: boolean, navigate: (path: string) => void, onSignOut: () => void}} options */
export function siteHeader(options) {
  return el('header', { className: 'site-header' },
    el('div', { className: 'site-header__inner' },
      el('a', { className: 'brand-link', href: '/', onclick: (event) => { event.preventDefault(); options.navigate('/'); } },
        ndhuEmblem('header'),
        el('span', { className: 'brand-copy' },
          el('span', { className: 'brand-code' }, '校園固定路線 · 展示版'),
          el('strong', {}, 'go by myself'),
          el('small', {}, '校園智慧投遞學生專題')
        )
      ),
      el('nav', { className: 'site-nav', 'aria-label': '主要導覽' },
        options.hasDelivery ? el('a', { href: '/delivery/current', onclick: (event) => { event.preventDefault(); options.navigate('/delivery/current'); } }, '目前投遞') : null,
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

/** @param {{code: string, message: string, retryable?: boolean}|null} error @param {() => void} [onDismiss] */
export function errorBanner(error, onDismiss) {
  if (!error) return null;
  return el('div', { className: 'alert alert--danger', role: 'alert' },
    el('div', {},
      el('strong', {}, error.code),
      el('p', {}, error.message),
      error.retryable ? el('small', {}, '此操作可用相同資料安全重試。') : null
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
    el('p', { className: 'status-detail' }, copy.detail)
  );
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
