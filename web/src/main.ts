import { mount } from 'svelte';
import '@xterm/xterm/css/xterm.css';
import './lib/tokens/tokens.css';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
