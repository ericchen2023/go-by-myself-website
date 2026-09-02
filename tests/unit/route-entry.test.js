import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('#mode-presentation', async () => import('../../src/production/mode-presentation.js'));

const { Application } = await import('../../src/app/application.js');

/**
 * Reaching the pickup page from inside the app used to skip the fetch: only
 * start() loaded the context, so a recipient who typed their reference landed
 * on a page that stayed 找不到可用的取件資訊 until they reloaded by hand. And
 * the first paint of a direct visit showed that same line before the lookup
 * had even run — an answer that had not arrived, rendered as a negative one.
 */
function adapterSpy() {
  return {
    loadPickupContext: vi.fn(async () => {}),
    snapshot() {
      return { session: null, delivery: null, actionError: null };
    },
    subscribe() {
      return () => {};
    }
  };
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.history.replaceState({}, '', '/');
  document.body.replaceChildren();
});

test('navigating to a pickup page inside the app fetches it', async () => {
  const adapter = adapterSpy();
  const app = new Application(document.createElement('div'), adapter);

  app.navigate('/pickup/pub-1');
  await vi.waitFor(() => expect(adapter.loadPickupContext).toHaveBeenCalledWith('pub-1'));
});

test('does not fetch the same pickup page twice', async () => {
  const adapter = adapterSpy();
  const app = new Application(document.createElement('div'), adapter);

  app.navigate('/pickup/pub-1');
  await vi.waitFor(() => expect(adapter.loadPickupContext).toHaveBeenCalledTimes(1));
  app.navigate('/pickup/pub-1');
  expect(adapter.loadPickupContext).toHaveBeenCalledTimes(1);
});

test('says it is looking, not that there is nothing', () => {
  window.history.replaceState({}, '', '/pickup/pub-1');
  const root = document.createElement('div');
  const app = new Application(root, adapterSpy());

  app.render();

  expect(root.textContent).toContain('正在讀取取件資訊');
  expect(root.textContent).not.toContain('找不到可用的取件資訊');
});

test('says there is nothing once the lookup has come back empty', async () => {
  window.history.replaceState({}, '', '/pickup/pub-1');
  const root = document.createElement('div');
  const app = new Application(root, adapterSpy());

  await app.start();

  expect(root.textContent).toContain('找不到可用的取件資訊');
});
