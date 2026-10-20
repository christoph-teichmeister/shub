<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal, type ITheme } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import type { TerminalControl } from '../../../../../shared/api.ts';
  import { api, wsUrl } from '../../stores/api.ts';
  import { app } from '../../stores/state.svelte.ts';
  import { toastError } from '../../stores/toasts.svelte.ts';
  import { readToken } from '../../tokens/tokens.ts';

  interface Props {
    sessionId: string;
    /** Project accent for the underline cursor. Defaults to brand pink. */
    accent?: string;
    /** Focus the terminal whenever this becomes true. */
    focused?: boolean;
    label?: string;
    /** Smaller font for split panes. */
    compact?: boolean;
  }
  let { sessionId, accent, focused = false, label = 'Terminal', compact = false }: Props = $props();

  let host = $state<HTMLDivElement>();
  let term = $state<Terminal>();

  function theme(): ITheme {
    const t = readToken;
    return {
      background: t('term-bg'),
      foreground: t('fg-2'),
      cursor: accent || t('pink'),
      cursorAccent: t('term-bg'),
      selectionBackground: t('selection'),
      black: t('panel'),
      red: t('pink'),
      green: t('status-your-turn'),
      yellow: t('yellow'),
      blue: t('status-working'),
      magenta: t('purple'),
      cyan: t('link'),
      white: t('fg'),
      brightBlack: t('muted'),
      brightRed: t('pink'),
      brightGreen: t('status-your-turn'),
      brightYellow: t('yellow'),
      brightBlue: t('status-working'),
      brightMagenta: t('purple'),
      brightCyan: t('link'),
      brightWhite: t('fg'),
    };
  }

  const paste = (body: Blob | string) => {
    if (body instanceof Blob || body) void api('sessionPaste', { params: { id: sessionId }, body }).catch(toastError);
  };

  onMount(() => {
    const t = new Terminal({
      cursorStyle: 'underline',
      cursorInactiveStyle: 'underline',
      cursorBlink: true,
      fontFamily: readToken('font-mono'),
      fontSize: parseFloat(readToken(compact ? 'text-sm' : 'text-md')),
      scrollback: 5000,
      theme: theme(),
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.loadAddon(new WebLinksAddon());
    t.open(host!);
    term = t;

    let ws: WebSocket | undefined;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let opened = false;
    const send = (data: string | Uint8Array) => ws?.readyState === WebSocket.OPEN && ws.send(data);
    const sendResize = () => {
      const msg: TerminalControl = { type: 'resize', cols: t.cols, rows: t.rows };
      send('\u0000' + JSON.stringify(msg));
    };
    const connect = () => {
      ws = new WebSocket(wsUrl(`/api/terminals/${encodeURIComponent(sessionId)}`));
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        if (opened) t.reset(); // tmux repaints the screen on re-attach
        opened = true;
        sendResize();
      };
      ws.onmessage = (m) => {
        if (typeof m.data !== 'string') t.write(new Uint8Array(m.data as ArrayBuffer));
        else if (!m.data.startsWith('\u0000')) t.write(m.data);
      };
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };
    connect();

    t.onData((d) => send(d));
    t.onBinary((d) => send(Uint8Array.from(d, (c) => c.charCodeAt(0))));
    t.onResize(sendResize);
    // Select to copy.
    t.onSelectionChange(() => {
      const s = t.getSelection();
      if (s) navigator.clipboard?.writeText(s).catch(() => {});
    });
    // Ctrl+V / Ctrl+Shift+V: let the browser fire its paste event (handled below) instead of sending ^V.
    // Ctrl+C stays an interrupt; Alt shortcuts are taken by the view before xterm sees them.
    // Ctrl+Left/Right jump a word: sent as Alt+B/F (ESC b/f), which readline and Claude's prompt understand,
    // since Alt+B itself toggles the sidebar.
    const wordJump: Record<string, string> = { ArrowLeft: '\u001bb', ArrowRight: '\u001bf' };
    t.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.key in wordJump) {
        if (e.type === 'keydown') send(wordJump[e.key]);
        return false;
      }
      return !((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v');
    });

    // Paste and drop go through the server (images become files, their path is typed in).
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) files.forEach(paste);
      else paste(e.clipboardData?.getData('text/plain') ?? '');
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) files.forEach(paste);
      else paste(e.dataTransfer?.getData('text/plain') ?? '');
      t.focus();
    };
    host!.addEventListener('paste', onPaste, true);
    host!.addEventListener('dragover', onDragOver);
    host!.addEventListener('drop', onDrop);

    const refit = () => {
      if (host!.offsetWidth && host!.offsetHeight) fit.fit();
    };
    const observer = new ResizeObserver(() => requestAnimationFrame(refit));
    observer.observe(host!);
    void document.fonts?.ready.then(refit);

    return () => {
      closed = true;
      clearTimeout(retry);
      observer.disconnect();
      ws?.close();
      t.dispose();
      term = undefined;
    };
  });

  $effect(() => {
    void app.themeVersion;
    void accent;
    if (term) term.options.theme = theme();
  });

  $effect(() => {
    if (focused && term) term.focus();
  });
</script>

<section class="terminal" aria-label={label}>
  <div class="host" bind:this={host}></div>
</section>

<style>
  .terminal {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    padding: var(--space-3) var(--space-4);
    background: var(--term-bg);
  }

  .host {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }
</style>
