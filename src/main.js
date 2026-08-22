import './styles.css';
import { createRuntimeAdapter } from '#runtime-adapter';
import { Application } from './app/application.js';

const root = document.querySelector('#app');
if (!(root instanceof HTMLElement)) throw new Error('App root not found');

const adapter = createRuntimeAdapter();
const application = new Application(root, adapter);

void application.start();

if (import.meta.env.DEV) {
  document.documentElement.dataset.release = 'development';
}
