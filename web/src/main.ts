import { mount } from 'svelte';
import '@xterm/xterm/css/xterm.css';
import './lib/tokens/fonts.css';
import './lib/tokens/tokens.css';
import App from './App.svelte';
import { registerLoader } from './lib/stores/loader.ts';

mount(App, { target: document.getElementById('app')! });

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void registerLoader();
}
