/// <reference types="vite/client" />

declare const __APP_MODE__: 'demo' | 'production';

interface Window {
  __gbmLcp: number;
}

declare module '#runtime-adapter' {
  export function createRuntimeAdapter(): import('./demo/adapter.js').DemoAdapter | import('./production/adapter.js').ProductionAdapter;
}
