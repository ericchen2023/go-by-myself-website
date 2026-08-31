import { beforeEach, expect, test, vi } from 'vitest';
import { homeScreen } from '../../src/app/home.js';
import { ProductionAdapter } from '../../src/production/adapter.js';

vi.mock('#mode-presentation', async () => import('../../src/production/mode-presentation.js'));

const { Application } = await import('../../src/app/application.js');

function productionAdapter() {
  return {
    snapshot() {
      return { session: null, delivery: null, actionError: null };
    },
    subscribe() {
      return () => {};
    }
  };
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  document.body.replaceChildren();
});

test('production shell omits nullable mode UI and never claims simulator behavior', () => {
  const root = document.createElement('div');
  document.body.append(root);
  const app = new Application(root, productionAdapter());

  app.render();

  expect(root.textContent).not.toContain('null');
  expect(root.textContent).toContain('校園固定路線 · 學生專題');
  expect(root.textContent).toContain('整合測試環境使用獨立資料庫與受信任控制服務');
  expect(root.textContent).not.toContain('展示模式使用測試帳號與模擬車輛');
});

test('production home fails closed without showing a legacy email-login fallback', () => {
  const screen = homeScreen({
    homeModeCopy: {
      divider: '或使用專題登入連結',
      cta: '進入整合測試',
      tag: '整合測試',
      intro: '整合測試環境使用獨立資料庫與受信任控制服務；真實車輛功能在現場核准前維持關閉。'
    },
    authTab: 'login',
    recoveryOpen: false,
    authNotice: '',
    error: null,
    googleDisabled: true,
    googleHelp: '此環境尚未完成 Google OAuth 設定，登入功能暫不可用。',
    authAlternative: null,
    recoveryText: '',
    setAuthTab: () => {},
    toggleRecovery: () => {},
    google: () => {},
    dismissError: () => {}
  });

  expect(screen.textContent).not.toContain('展示模式使用測試帳號與模擬車輛');
  expect(screen.textContent).toContain('整合測試環境使用獨立資料庫與受信任控制服務');
  expect(screen.textContent).not.toContain('專題登入連結');
  expect(screen.querySelector('.divider')).toBeNull();
  const googleButton = /** @type {HTMLButtonElement|null} */ (screen.querySelector('button.button--primary'));
  expect(googleButton?.disabled).toBe(true);
  expect(googleButton?.getAttribute('aria-describedby')).toBe('google-auth-help');
});

test('production adapter rejects Google OAuth while the capability is disabled', async () => {
  const adapter = new ProductionAdapter();
  await expect(adapter.signInWithGoogle()).rejects.toMatchObject({ code: 'AUTH_PROVIDER_UNAVAILABLE' });
});
