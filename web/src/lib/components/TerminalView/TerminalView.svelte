<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal, type ITheme } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { WebglAddon } from '@xterm/addon-webgl';
  import type { TerminalControl } from '../../../../../shared/api.ts';
  import { api, wsProtocols, wsUrl } from '../../stores/api.ts';
  import { app, terminalSettings } from '../../stores/state.svelte.ts';
  import { toastError } from '../../stores/toasts.svelte.ts';
  import { readToken } from '../../tokens/tokens.ts';

  interface Props {
    sessionId: string;
    /** Project accent for the underline cursor. Defaults to brand pink. */
    accent?: string;
    /** Focus the terminal whenever this becomes true. */
    focused?: boolean;
    label?: string;
    /** One px smaller font for split panes. */
    compact?: boolean;
  }
  let { sessionId, accent, focused = false, label = 'Terminal', compact = false }: Props = $props();

  let host = $state<HTMLDivElement>();
  let term = $state<Terminal>();
  let fit: FitAddon | undefined;

  /** Font and cursor options from Settings > Terminal. */
  function look() {
    const s = terminalSettings();
    return {
      fontFamily: `${s.fontFamily}, ${s.fallbackFont}`,
      fontSize: s.fontSize - (compact ? 1 : 0),
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      cursorStyle: s.cursorStyle,
      cursorInactiveStyle: s.cursorStyle,
      cursorBlink: s.cursorBlink,
      scrollback: s.scrollback,
    } as const;
  }

  function theme(): ITheme {
    const t = readToken;
    return {
      background: t('term-bg'),
      foreground: t('term-fg'),
      cursor: accent || t('term-cursor'),
      cursorAccent: t('term-bg'),
      selectionBackground: t('selection'),
      black: t('term-black'),
      red: t('term-red'),
      green: t('term-green'),
      yellow: t('term-yellow'),
      blue: t('term-blue'),
      magenta: t('term-magenta'),
      cyan: t('term-cyan'),
      white: t('term-white'),
      brightBlack: t('term-bright-black'),
      brightRed: t('term-bright-red'),
      brightGreen: t('term-bright-green'),
      brightYellow: t('term-bright-yellow'),
      brightBlue: t('term-bright-blue'),
      brightMagenta: t('term-bright-magenta'),
      brightCyan: t('term-bright-cyan'),
      brightWhite: t('term-bright-white'),
    };
  }

  const paste = (body: Blob | string) => {
    if (body instanceof Blob || body) void api('sessionPaste', { params: { id: sessionId }, body }).catch(toastError);
  };

  onMount(() => {
    const t = new Terminal({ ...look(), theme: theme() });
    fit = new FitAddon();
    t.loadAddon(fit);
    t.loadAddon(new WebLinksAddon());
    t.open(host!);
    // WebGL draws box-drawing glyphs cell-exact, so Claude's tables connect; the DOM renderer leaves gaps.
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => gl.dispose());
      t.loadAddon(gl);
    } catch {
      // No WebGL: stay on the DOM renderer.
    }
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
    const connect = async () => {
      const protocols = await wsProtocols();
      if (closed) return;
      ws = new WebSocket(wsUrl(`/api/terminals/${encodeURIComponent(sessionId)}`), protocols);
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
        if (!closed) retry = setTimeout(() => void connect(), 2000);
      };
    };
    void connect();

    t.onData((d) => send(d));
    t.onBinary((d) => send(Uint8Array.from(d, (c) => c.charCodeAt(0))));
    t.onResize(sendResize);
    // Select to copy.
    t.onSelectionChange(() => {
      const s = t.getSelection();
      if (s) navigator.clipboard?.writeText(s).catch(() => {});
    });
    // Apps that own the mouse (Claude's fullscreen UI) copy their own selection with OSC 52 `ESC]52;<sel>;<base64>`.
    // tmux forwards it with an empty <sel>. Write only: a `?` read request is ignored, so no app can read the clipboard.
    t.parser.registerOscHandler(52, (data) => {
      const b64 = data.slice(data.indexOf(';') + 1);
      if (b64 && b64 !== '?') {
        try {
          const text = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
          navigator.clipboard?.writeText(text).catch(() => {});
        } catch {
          // Not base64: ignore.
        }
      }
      return true;
    });
    // Ctrl+V / Ctrl+Shift+V: let the browser fire its paste event (handled below) instead of sending ^V.
    // Ctrl+C stays an interrupt; Alt shortcuts are taken by the view before xterm sees them.
    // Ctrl+Left/Right jump a word: sent as Alt+B/F (ESC b/f), which readline and Claude's prompt understand,
    // since Alt+B itself toggles the sidebar. Ctrl+Backspace/Delete delete a word: ^W and Alt+D (ESC d).
    const wordKeys: Record<string, string> = {
      ArrowLeft: '\u001bb',
      ArrowRight: '\u001bf',
      Backspace: '\u0017',
      Delete: '\u001bd',
    };
    t.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.key in wordKeys) {
        if (e.type === 'keydown') send(wordKeys[e.key]);
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
      if (host!.offsetWidth && host!.offsetHeight) fit?.fit();
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
      fit = undefined;
    };
  });

  $effect(() => {
    void app.themeVersion;
    void accent;
    if (term) term.options.theme = theme();
  });

  $effect(() => {
    const options = look();
    if (!term) return;
    Object.assign(term.options, options);
    if (host?.offsetWidth && host.offsetHeight) fit?.fit(); // cell size changed: new cols/rows
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
