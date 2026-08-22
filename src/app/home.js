import { el, ndhuEmblem, projectMark } from './dom.js';
import { errorBanner } from './components.js';
import { createRoutePreview } from '../map/map-view.js';

/** @param {{authTab: 'login'|'signup', recoveryOpen: boolean, error: {code:string,message:string,retryable?:boolean}|null, googleDisabled:boolean, googleHelp:string, authAlternative:Node, recoveryText:string, setAuthTab: (tab:'login'|'signup')=>void, toggleRecovery:()=>void, google:()=>void, dismissError:()=>void}} options */
export function homeScreen(options) {
  const authTitle = options.authTab === 'login' ? '進入派送站' : '建立專題身份';
  const googleLabel = options.authTab === 'login' ? '使用東華 Google 帳號登入' : '使用東華 Google 帳號建立帳號';
  const authPanel = el('section', { className: 'auth-panel', 'aria-labelledby': 'auth-title' },
    el('div', { className: 'auth-panel__index', 'aria-hidden': 'true' }, '01 / 08'),
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
    el('p', { className: 'eyebrow' }, options.authTab === 'login' ? 'SENDER ACCESS' : 'FIRST-TIME ONBOARDING'),
    el('h2', { id: 'auth-title' }, authTitle),
    el('p', { className: 'muted' }, '網站只接收 Google 或專題 magic link 的驗證結果，不會要求或保存東華密碼。'),
    errorBanner(options.error, options.dismissError),
    el('button', {
      className: 'button button--primary button--full',
      type: 'button',
      disabled: options.googleDisabled,
      onclick: options.google
    }, googleLabel),
    options.googleHelp ? el('p', { className: 'field-help' }, options.googleHelp) : null,
    el('div', { className: 'divider', role: 'separator' }, el('span', {}, '或使用展示通行證')),
    options.authAlternative,
    el('button', { className: 'text-button', type: 'button', onclick: options.toggleRecovery }, '忘記如何登入？'),
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
        el('p', { className: 'eyebrow' }, 'EAST COAST DISPATCH · ROUTE 01'),
        el('h1', { id: 'home-title' },
          el('span', { className: 'hero-title-en', 'aria-hidden': 'true' },
            el('span', {}, 'GO'),
            el('span', {}, 'BY'),
            el('span', {}, 'MYSELF')
          ),
          el('span', { className: 'hero-title-zh' }, '校園自走車投遞網站')
        ),
        el('p', { className: 'lead' }, '從固定站點放件，到取件碼開艙；每一步都以真實狀態為準，不把「已送出命令」說成「已完成」。'),
        el('div', { className: 'hero-route-copy', 'aria-label': '投遞流程摘要' },
          el('span', {}, '放件'),
          el('span', { 'aria-hidden': 'true' }, '→'),
          el('span', {}, '沿線追蹤'),
          el('span', { 'aria-hidden': 'true' }, '→'),
          el('span', {}, '安全取件')
        ),
        el('ul', { className: 'feature-tags', 'aria-label': '專案功能' },
          el('li', {}, '04 固定站點'),
          el('li', {}, '08 投遞步驟'),
          el('li', {}, '01 動態路線')
        )
      ),
      el('div', { className: 'hero-map-shell' },
        el('div', { className: 'hero-map-kicker' },
          el('span', {}, 'CAMPUS SCHEMATIC'),
          el('span', {}, 'LIVE / DEMO')
        ),
        createRoutePreview(),
        el('div', { className: 'hero-map-caption' },
          projectMark('P'),
          el('p', {}, el('strong', {}, '固定路線，不公開原始座標'), el('span', {}, '車輛只顯示在核准的 schematic route 上'))
        )
      )
    ),
    el('section', { className: 'home-access', 'aria-label': '開始投遞' },
      el('div', { className: 'access-intro' },
        el('p', { className: 'eyebrow' }, 'YOUR NEXT MOVE'),
        el('h2', {}, '先確認身份，\n再選放件站。'),
        el('p', {}, '成果展示模式使用合成身份、模擬車輛與假通知，不需要 Supabase、簡訊服務或真實自走車。'),
        el('div', { className: 'access-safety-note' },
          el('span', { 'aria-hidden': 'true' }, 'i'),
          el('p', {}, '校徽為識別校園情境之用；本網站仍是學生專題，不代表校方已核准實際營運。')
        )
      ),
      authPanel
    )
  );
}
