import { el, ndhuEmblem, projectMark } from './dom.js';
import { errorBanner } from './components.js';
import { createRoutePreview } from '../map/map-view.js';

/** @param {{authTab: 'login'|'signup', recoveryOpen: boolean, error: {code:string,message:string,retryable?:boolean}|null, googleDisabled:boolean, googleHelp:string, authAlternative:Node, recoveryText:string, setAuthTab: (tab:'login'|'signup')=>void, toggleRecovery:()=>void, google:()=>void, dismissError:()=>void}} options */
export function homeScreen(options) {
  const authTitle = options.authTab === 'login' ? '登入後開始投遞' : '第一次使用';
  const googleLabel = options.authTab === 'login' ? '使用東華 Google 帳號登入' : '使用東華 Google 帳號建立帳號';
  const authPanel = el('section', { className: 'auth-panel', 'aria-labelledby': 'auth-title' },
    el('div', { className: 'auth-panel__index', 'aria-hidden': 'true' }, '從這裡開始'),
    el('div', { className: 'segmented-tabs', role: 'tablist', 'aria-label': '帳號操作' },
      el('button', {
        role: 'tab',
        type: 'button',
        'aria-selected': options.authTab === 'login' ? 'true' : 'false',
        className: options.authTab === 'login' ? 'is-active' : '',
        onclick: () => options.setAuthTab('login')
      }, '登入'),
      el('button', {
        role: 'tab',
        type: 'button',
        'aria-selected': options.authTab === 'signup' ? 'true' : 'false',
        className: options.authTab === 'signup' ? 'is-active' : '',
        onclick: () => options.setAuthTab('signup')
      }, '註冊')
    ),
    el('h2', { id: 'auth-title' }, authTitle),
    el('p', { className: 'muted' }, '登入會由 Google 或專題登入連結完成。我們不會向你索取或保存東華密碼。'),
    errorBanner(options.error, options.dismissError),
    el('button', {
      className: 'button button--primary button--full',
      type: 'button',
      disabled: options.googleDisabled,
      onclick: options.google
    }, googleLabel),
    options.googleHelp ? el('p', { className: 'field-help' }, options.googleHelp) : null,
    el('div', { className: 'divider', role: 'separator' }, el('span', {}, '或先體驗完整流程')),
    options.authAlternative,
    el('button', { className: 'text-button', type: 'button', onclick: options.toggleRecovery }, '登入遇到問題？'),
    options.recoveryOpen ? el('div', { className: 'recovery-note', role: 'status' }, options.recoveryText) : null,
    el('p', { className: 'project-disclaimer' }, '學生專題，非 NDHU 官方服務')
  );

  return el('main', { id: 'main-content', className: 'home-main' },
    el('section', { className: 'home-hero', 'aria-labelledby': 'home-title' },
      el('div', { className: 'hero-copy' },
        el('div', { className: 'official-lockup' },
          ndhuEmblem('hero'),
          el('span', {},
            el('strong', {}, '國立東華大學'),
            el('small', {}, 'NATIONAL DONG HWA UNIVERSITY')
          )
        ),
        el('h1', { id: 'home-title' },
          el('span', { className: 'hero-title-en' }, 'go by myself'),
          el('span', { className: 'hero-title-zh' }, '校園自走車投遞網站')
        ),
        el('p', { className: 'lead' }, '選好放件站和收件站後，車輛會沿固定路線完成投遞。畫面會隨實際進度更新。'),
        el('div', { className: 'hero-route-copy', 'aria-label': '投遞流程摘要' },
          el('span', {}, '放件'),
          el('span', { 'aria-hidden': 'true' }, '→'),
          el('span', {}, '沿線追蹤'),
          el('span', { 'aria-hidden': 'true' }, '→'),
          el('span', {}, '安全取件')
        ),
        el('ul', { className: 'feature-tags', 'aria-label': '專案功能' },
          el('li', {}, '4 個固定站點'),
          el('li', {}, '8 步完成投遞'),
          el('li', {}, '路線即時更新')
        )
      ),
      el('div', { className: 'hero-map-shell' },
        el('div', { className: 'hero-map-kicker' },
          el('span', {}, '校園固定路線'),
          el('span', {}, '展示模擬')
        ),
        createRoutePreview(),
        el('div', { className: 'hero-map-caption' },
          projectMark('路'),
          el('p', {}, el('strong', {}, '固定路線，不公開原始座標'), el('span', {}, '畫面只呈現固定路線上的車輛位置，不公開精確座標。'))
        )
      )
    ),
    el('section', { className: 'home-access', 'aria-label': '開始投遞' },
      el('div', { className: 'access-intro' },
        el('h2', {}, '先確認身份，\n再選放件站。'),
        el('p', {}, '展示模式使用測試帳號和模擬車輛，不會寄出通知，也不會控制真實車輛。'),
        el('div', { className: 'access-safety-note' },
          el('span', { 'aria-hidden': 'true' }, 'i'),
          el('p', {}, '校徽為識別校園情境之用；本網站仍是學生專題，不代表校方已核准實際營運。')
        )
      ),
      authPanel
    )
  );
}
