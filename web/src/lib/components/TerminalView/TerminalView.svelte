<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal, type ITheme } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import ImageViewer from '../ImageViewer/ImageViewer.svelte';
  import { allImagePaths, imagePathsAt, NOTE_PATH } from './imagePaths.ts';
  import type { TerminalControl } from '../../../../../shared/api.ts';
  import { api, wsTarget } from '../../stores/api.ts';
  import { markTerminalUse } from '../../stores/loader.ts';
  import { app, terminalSettings } from '../../stores/state.svelte.ts';
  import { noteFile } from '../../stores/noteFile.svelte.ts';
  import { toastError } from '../../stores/toasts.svelte.ts';
  import { onResume } from '../../stores/resume.ts';
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
    /** Phone: never size the shared tmux window. The terminal takes the window's size from the server and is scaled to fit. */
    follow?: boolean;
  }
  let { sessionId, accent, focused = false, label = 'Terminal', compact = false, follow = false }: Props = $props();

  const booting = $derived(app.sessions.find((x) => x.id === sessionId)?.booting);
  let host = $state<HTMLDivElement>();
  let term = $state<Terminal>();
  let fit: FitAddon | undefined;
  let reconnecting = $state(false);
  let scale = $state(1);

  // Follower: the terminal has the desktop's size; shrink it to fit (not below half size, the rest scrolls off).
  function rescale() {
    const box = host?.querySelector('.xterm') as HTMLElement | null;
    if (!box || !host) return;
    scale = Math.max(0.5, Math.min(1, host.clientWidth / box.offsetWidth, host.clientHeight / box.offsetHeight));
  }

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

  // Image paths in the output (screenshots, pastes) open in the image viewer.
  let images = $state<string[] | null>(null);
  let imageIndex = $state(0);
  let imageSrc = $state<string | null>(null);

  function openImage(t: Terminal, path: string) {
    const all = allImagePaths(t.buffer.active);
    images = all.includes(path) ? all : [path];
    imageIndex = images.indexOf(path);
  }

  $effect(() => {
    const path = images?.[imageIndex];
    if (!path) return;
    let url = '';
    let gone = false;
    imageSrc = null;
    api<Blob>('image', { query: { path }, blob: true }).then(
      (blob) => {
        if (gone) return;
        url = URL.createObjectURL(blob);
        imageSrc = url;
      },
      () => !gone && (imageSrc = ''),
    );
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  });

  // OSC 8 links (xterm's linkHandler) and WebLinksAddon can both fire for one click: open one link per click.
  // The two can report different strings for the same link (OSC 8 uri vs. matched text), so any open within a second counts.
  let lastOpen = 0;
  const openLink = (_e: MouseEvent, uri: string) => {
    const now = Date.now();
    if (now - lastOpen < 1000) return;
    lastOpen = now;
    // An anchor click, like the links in the app's own markup: window.open opened two tabs in the installed PWA.
    const a = Object.assign(document.createElement('a'), { href: uri, target: '_blank', rel: 'noopener noreferrer' });
    a.click();
  };

  const paste = (body: Blob | string) => {
    markTerminalUse();
    if (body instanceof Blob || body) void api('sessionPaste', { params: { id: sessionId }, body }).catch(toastError);
  };

  onMount(() => {
    const t = new Terminal({ ...look(), theme: theme(), linkHandler: { activate: openLink } });
    fit = new FitAddon();
    t.loadAddon(fit);
    t.loadAddon(new WebLinksAddon(openLink));
    t.registerLinkProvider({
      provideLinks(y, done) {
        const links = imagePathsAt(t.buffer.active, y - 1).map((p) => ({
          text: p.path,
          range: { start: p.start, end: p.end },
          activate: () => openImage(t, p.path),
        }));
        done(links.length ? links : undefined);
      },
    });
    // Markdown notes of the knowledge base open in the notes panel; the server says which paths are notes.
    const notes = new Map<string, Promise<{ file: string; url: string | null } | null>>();
    const lookup = (path: string) => {
      if (!notes.has(path)) {
        notes.set(
          path,
          api<{ file: string; url: string | null }>('markdownLink', { query: { path } }).catch(() => null),
        );
      }
      return notes.get(path)!;
    };
    t.registerLinkProvider({
      async provideLinks(y, done) {
        const found = imagePathsAt(t.buffer.active, y - 1, NOTE_PATH);
        const targets = await Promise.all(found.map((p) => lookup(p.path)));
        const links = found.flatMap((p, i) =>
          targets[i]
            ? [{ text: p.path, range: { start: p.start, end: p.end }, activate: () => (noteFile.target = targets[i]) }]
            : [],
        );
        done(links.length ? links : undefined);
      },
    });
    t.open(host!);
    // Phone: the message field below is the place to type. Gboard's autocorrect rewrites half-typed words and xterm
    // sends every rewrite as keystrokes, so words repeat; with no on-screen keyboard here a tap only selects.
    if (compact) t.textarea?.setAttribute('inputmode', 'none');
    term = t;

    let ws: WebSocket | undefined;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    let opened = false;
    let gen = 0; // a resume while a connect is in flight must not leave two sockets
    const send = (data: string | Uint8Array) => ws?.readyState === WebSocket.OPEN && ws.send(data);
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    // Anything the user types, as opposed to resize and control frames: it holds back an update reload.
    const typed = (data: string | Uint8Array) => (markTerminalUse(), send(data));
    const sendResizeNow = () => {
      const msg: TerminalControl = { type: 'resize', cols: t.cols, rows: t.rows };
      send('\u0000' + JSON.stringify(msg));
    };
    // Debounced: dragging a split fires many fits, tmux should reflow once.
    const sendResize = () => {
      clearTimeout(resizeTimer);
      if (!follow) resizeTimer = setTimeout(sendResizeNow, 150);
    };
    const connect = async () => {
      const mine = ++gen;
      // Re-attach (seed=1): the server sends recent output before the live repaint.
      const query = new URLSearchParams({ ...(follow && { follow: '1' }), ...(opened && { seed: '1' }) });
      const { url, protocols } = await wsTarget(`/api/terminals/${encodeURIComponent(sessionId)}?${query}`);
      if (closed || mine !== gen) return;
      ws = new WebSocket(url, protocols);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        if (opened) t.reset(); // the seed and tmux's repaint refill it
        opened = true;
        delay = 1000;
        reconnecting = false;
        if (!follow) sendResizeNow();
      };
      ws.onmessage = (m) => {
        if (typeof m.data === 'string' && m.data.startsWith('\u0000')) {
          const msg = JSON.parse(m.data.slice(1)) as TerminalControl;
          if (msg.type === 'size') {
            t.resize(msg.cols, msg.rows);
            requestAnimationFrame(rescale); // xterm updates its DOM size after resize
          }
        } else t.write(typeof m.data === 'string' ? m.data : new Uint8Array(m.data as ArrayBuffer));
      };
      ws.onclose = () => {
        if (closed) return;
        reconnecting = true;
        retry = setTimeout(() => void connect(), delay);
        delay = Math.min(delay * 2, 30_000);
      };
    };
    void connect();
    // Back from sleep: a socket can look open and be dead, so reconnect now instead of waiting for the backoff.
    const off = onResume(() => {
      clearTimeout(retry);
      if (ws) ws.onclose = null;
      ws?.close();
      delay = 1000;
      void connect();
    });

    t.onData(typed);
    t.onBinary((d) => send(Uint8Array.from(d, (c) => c.charCodeAt(0))));
    t.onResize(sendResize);
    // Select to copy (not for the Ctrl+A highlight, which is only a cue).
    let allSelected = false;
    t.onSelectionChange(() => {
      const s = t.getSelection();
      if (!s) allSelected = false; // a click dropped the cue: disarm
      if (s && !allSelected) navigator.clipboard?.writeText(s).catch(() => {});
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
    // Ctrl+A arms "select all" for the input line (highlights the cursor row as a cue, nothing is copied); the next plain Backspace/Delete
    // then clears the line (^E ^U: end of line, kill to start) instead of being sent as a single backspace.
    t.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown') {
        const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
        if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'a') {
          allSelected = true;
          t.select(0, t.buffer.active.baseY + t.buffer.active.cursorY, t.cols);
          return false;
        }
        if (allSelected && plain && (e.key === 'Backspace' || e.key === 'Delete')) {
          typed('\u0005\u0015');
          allSelected = false;
          t.clearSelection();
          return false;
        }
        if (allSelected && !['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
          allSelected = false;
          t.clearSelection();
        }
      }
      if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.key in wordKeys) {
        if (e.type === 'keydown') typed(wordKeys[e.key]);
        return false;
      }
      return !((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v');
    });

    // Paste and drop go through the server (files of any type are saved, their path is typed in).
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
    // A swipe is not a wheel: xterm shows tmux's alternate screen (no scrollback of its own) and Claude's fullscreen
    // UI scrolls on mouse-wheel reports, so each line of finger travel becomes one wheel event, which xterm turns
    // into that report. Dragging down shows older output, like a native list.
    let swipe: { y: number; startY: number; rest: number; active: boolean } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      swipe = e.touches.length === 1 && y !== undefined ? { y, startY: y, rest: 0, active: false } : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const screen = host!.querySelector('.xterm-screen');
      const touch = e.touches[0];
      if (!swipe || e.touches.length !== 1 || !touch || !screen || !t.rows) return;
      if (!swipe.active && Math.abs(touch.clientY - swipe.startY) < 8) return; // below that it is a tap
      swipe.active = true;
      e.preventDefault();
      const cell = (screen.clientHeight / t.rows) * scale; // finger pixels, the follower is scaled down
      swipe.rest += swipe.y - touch.clientY;
      swipe.y = touch.clientY;
      const lines = Math.min(10, Math.trunc(Math.abs(swipe.rest) / cell));
      const deltaY = Math.sign(swipe.rest);
      swipe.rest -= deltaY * lines * cell;
      for (let i = 0; i < lines; i++) {
        const wheel = { deltaY, deltaMode: WheelEvent.DOM_DELTA_LINE, clientX: touch.clientX, clientY: touch.clientY };
        screen.dispatchEvent(new WheelEvent('wheel', { ...wheel, bubbles: true, cancelable: true }));
      }
    };
    host!.addEventListener('touchstart', onTouchStart, { passive: true });
    host!.addEventListener('touchmove', onTouchMove, { passive: false });
    host!.addEventListener('paste', onPaste, true);
    host!.addEventListener('dragover', onDragOver);
    host!.addEventListener('drop', onDrop);

    const refit = () => {
      // A queued frame or fonts.ready can land after teardown, when host is already null.
      if (closed || !host?.offsetWidth || !host.offsetHeight) return;
      if (follow) rescale();
      else fit?.fit();
    };
    const observer = new ResizeObserver(() => requestAnimationFrame(refit));
    observer.observe(host!);
    void document.fonts?.ready.then(refit);
    // WebGL draws box-drawing glyphs cell-exact, so Claude's tables connect; the DOM renderer leaves gaps. The addon
    // is a chunk of its own: until it arrives, and without WebGL or when it fails to load, the DOM renderer draws.
    void import('@xterm/addon-webgl')
      .then(({ WebglAddon }) => {
        if (closed) return;
        const gl = new WebglAddon();
        gl.onContextLoss(() => gl.dispose());
        t.loadAddon(gl);
        refit(); // the new renderer may measure the cells a pixel off
      })
      .catch(() => {});

    return () => {
      closed = true;
      off();
      clearTimeout(retry);
      clearTimeout(resizeTimer);
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
    if (!follow && host?.offsetWidth && host.offsetHeight)
      fit?.fit(); // cell size changed: new cols/rows
    else if (follow) requestAnimationFrame(rescale);
  });

  $effect(() => {
    if (focused && term) term.focus();
  });
</script>

<section class="terminal" aria-label={label}>
  <div class="host" class:follow bind:this={host} style:--scale={scale}></div>
  {#if reconnecting}
    <div class="reconnecting" role="status">Reconnecting…</div>
  {/if}
  {#if booting}
    <div class="boot" role="status">
      <span class="prompt">claude<span class="cursor">_</span></span>
      <span class="text">Starting session…</span>
    </div>
  {/if}
</section>
<ImageViewer
  paths={images}
  index={imageIndex}
  src={imageSrc}
  onstep={(i) => (imageIndex = i)}
  onclose={() => {
    images = null;
    term?.focus();
  }}
/>

<style>
  /* Scrolling up past the top of the scrollback must not chain to the page (mobile pull-to-refresh reloads the PWA). */
  .terminal :global(.xterm-viewport) {
    overscroll-behavior: contain;
  }

  .terminal {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    padding: var(--space-3) var(--space-4);
    background: var(--term-bg);
  }

  .boot {
    position: absolute;
    inset: 0;
    z-index: var(--z-raised);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    background: var(--term-bg);
    font-family: var(--font-mono);
  }

  .prompt {
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--fg);
  }

  .cursor {
    color: var(--primary);
  }

  .text {
    font-size: var(--text-sm);
    color: var(--muted);
  }

  @media (prefers-reduced-motion: no-preference) {
    .cursor {
      animation: boot-blink 1s steps(1) infinite;
    }

    .text {
      animation: boot-pulse 1.6s var(--ease-standard) infinite;
    }
  }

  @keyframes boot-blink {
    50% {
      opacity: 0;
    }
  }

  @keyframes boot-pulse {
    50% {
      opacity: 0.4;
    }
  }

  .reconnecting {
    position: absolute;
    top: var(--space-2);
    right: var(--space-4);
    z-index: var(--z-raised);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--raised);
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .host.follow {
    overflow: hidden;
  }

  .host.follow :global(.xterm) {
    width: max-content;
    transform: scale(var(--scale));
    transform-origin: top left;
  }

  .host {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;

    /* Swipes are turned into wheel events by the view; the browser must not pan or pull-to-refresh meanwhile. */
    touch-action: none;
  }
</style>
