import { afterEach } from 'vitest';

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

