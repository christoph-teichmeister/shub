<script lang="ts">
  import type { Config, ThemeDef } from '../../../../shared/api.ts';
  import Button from '../components/Button/Button.svelte';
  import Icon from '../components/Icon/Icon.svelte';
  import SelectField from '../components/SelectField/SelectField.svelte';
  import StatusBadge from '../components/StatusBadge/StatusBadge.svelte';
  import TextField from '../components/TextField/TextField.svelte';
  import Wordmark from '../components/Wordmark/Wordmark.svelte';
  import { api } from '../stores/api.ts';
  import { go, href } from '../stores/router.svelte.ts';
  import { app, loadConfig } from '../stores/state.svelte.ts';
  import { toast, toastError } from '../stores/toasts.svelte.ts';
  import { contrastRatio } from '../tokens/contrast.ts';
  import { BUILT_IN_THEMES, resolveTokens, TOKEN_NAMES, type TokenName } from '../tokens/tokens.ts';

  /** Theme id to edit, or "new". A built-in id starts a new theme based on it. */
  let { id }: { id: string } = $props();

  const MAIN: { name: TokenName; label: string }[] = [
    { name: 'bg', label: 'Background' },
    { name: 'panel', label: 'Sidebar' },
    { name: 'primary', label: 'Buttons / accent' },
    { name: 'fg', label: 'Text' },
    { name: 'muted', label: 'Muted text' },
  ];

  const custom = (app.config?.themes ?? []).find((t) => t.id === id && !t.builtIn);
  const builtIn = BUILT_IN_THEMES.find((t) => t.id === id);

  let name = $state(custom?.name ?? (builtIn ? `${builtIn.name} copy` : ''));
  let base = $state(custom?.base ?? builtIn?.id ?? 'monokai');
  let overrides = $state<Record<string, string>>({ ...(custom?.tokens ?? {}) });
  let showAll = $state(false);
  // Token whose row is hovered (wins) or focused; it blinks in the preview.
  let hovered = $state<TokenName | null>(null);
  let focused = $state<TokenName | null>(null);
  const active = $derived(hovered ?? focused);
  let saving = $state(false);

  const baseTheme = $derived(BUILT_IN_THEMES.find((t) => t.id === base) ?? BUILT_IN_THEMES[0]);
  const tokens = $derived(resolveTokens(baseTheme, overrides));
  const previewVars = $derived(
    TOKEN_NAMES.map((n) =>
      n === active
        ? `--${n}: var(--flash); --flash-from: ${tokens[n]}; --flash-to: ${flashTo(tokens[n])}; --flash: ${flashTo(tokens[n])}`
        : `--${n}: ${tokens[n]}`,
    ).join('; '),
  );
  const rows = $derived(showAll ? TOKEN_NAMES.map((n) => ({ name: n, label: n })) : MAIN);

  const checks = $derived([
    { label: 'Text', ratio: contrastRatio(tokens.fg, tokens.bg) },
    { label: 'Muted text', ratio: contrastRatio(tokens.muted, tokens.bg) },
    { label: 'Muted text on sidebar', ratio: contrastRatio(tokens.muted, tokens.panel) },
  ]);

  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'theme';
  const themeId = $derived.by(() => {
    if (custom) return custom.id;
    const taken = new Set([...BUILT_IN_THEMES, ...(app.config?.themes ?? [])].map((t) => t.id));
    let out = slug(name);
    for (let n = 2; taken.has(out); n++) out = `${slug(name).slice(0, 36)}-${n}`;
    return out;
  });
  const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);
  /** Opposite colour so the blink stands out from the real one; magenta for non-hex values. */
  const invert = (v: string) =>
    isHex(v) ? `#${(0xffffff ^ parseInt(v.slice(1), 16)).toString(16).padStart(6, '0')}` : '#ff00ff';
  /** Pulse target: part way to the opposite colour, so it's visible without glaring. */
  const flashTo = (v: string) => `color-mix(in oklab, ${v}, ${invert(v)} 60%)`;

  function set(token: string, value: string) {
    if (value === resolveTokens(baseTheme)[token as TokenName]) delete overrides[token];
    else overrides[token] = value;
  }

  function def(): Omit<ThemeDef, 'builtIn' | 'id'> {
    return { name: name.trim(), base, tokens: $state.snapshot(overrides) };
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    const ok = await api('themes', { params: { id: themeId }, body: def() }).then(() => true, toastError);
    const config = ok && (await api<Config>('settings', { body: { activeTheme: themeId } }).catch(toastError));
    saving = false;
    if (!config) return;
    await loadConfig();
    toast(`Using ${name.trim()}`);
    go('settings');
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ id: themeId, ...def() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${themeId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
</script>

<div class="page">
  <div class="content">
    <a class="back" href={href('settings')}>← Settings</a>
    <h1>{custom ? `Edit ${custom.name}` : 'New theme'}</h1>
    <div class="cols">
      <form class="form" onsubmit={save}>
        <TextField label="Name" bind:value={name} required autocomplete="off" />
        <SelectField
          label="Based on"
          bind:value={base}
          options={BUILT_IN_THEMES.map((t) => ({ value: t.id, label: t.name }))}
          hint="Everything you don't change comes from the base theme."
        />
        <p class="hint">Point at a colour to make it blink in the preview.</p>
        <div class="colors">
          {#each rows as r (r.name)}
            <div
              class="color"
              class:active={active === r.name}
              role="group"
              onmouseenter={() => (hovered = r.name)}
              onmouseleave={() => (hovered = null)}
              onfocusin={() => (focused = r.name)}
              onfocusout={() => (focused = null)}
            >
              <input
                type="color"
                aria-label="Pick {r.label}"
                value={isHex(tokens[r.name]) ? tokens[r.name] : '#000000'}
                oninput={(e) => set(r.name, e.currentTarget.value)}
              />
              <div class="grow">
                <TextField
                  label={r.name in overrides ? r.label : `${r.label} · from base`}
                  mono
                  value={tokens[r.name]}
                  oninput={(e) => set(r.name, e.currentTarget.value)}
                />
              </div>
            </div>
          {/each}
        </div>
        <div>
          <Button variant="ghost" onclick={() => (showAll = !showAll)}
            >{showAll ? 'Show the main colours only' : 'Show all colours (terminal palette too)'}</Button
          >
        </div>

        <div class="checks" aria-live="polite">
          <span class="label">Readability on this background</span>
          {#each checks as c (c.label)}
            {@const ok = c.ratio !== null && c.ratio >= 4.5}
            <span class="check" class:ok class:bad={!ok}>
              <Icon name={ok ? 'check' : 'close'} />
              {c.label}
              {c.ratio === null
                ? 'not a #hex colour'
                : `${c.ratio.toFixed(1)}:1 · ${ok ? 'fine' : 'too low (needs 4.5)'}`}
            </span>
          {/each}
        </div>

        <div class="actions">
          <Button variant="primary" type="submit" disabled={saving}>Save and use</Button>
          <Button onclick={exportJson}>Export as JSON</Button>
          <Button variant="ghost" onclick={() => go('settings')}>Cancel</Button>
        </div>
      </form>

      <section class="preview-wrap" aria-label="Live preview">
        <span class="label">Live preview</span>
        <div class="preview" class:flashing={active} style={previewVars}>
          <div class="p-side">
            <Wordmark size="sm" />
            <span class="p-row selected">ai-portal</span>
            <span class="p-row">listo</span>
            <span class="p-row">dotfiles</span>
            <span class="p-muted">Muted text sample</span>
          </div>
          <div class="p-main">
            <div class="p-head">
              <strong>ai-portal</strong>
              <Button variant="primary" size="sm">New session</Button>
              <StatusBadge text="1 needs you" tone="needs-you" />
              <StatusBadge text="2 working" tone="working" />
            </div>
            <pre class="p-term"><span class="p-accent">&gt;</span> /worktree-review 2136
<span class="p-ok">●</span> Port slot 3 free · <span class="p-link">localhost:8003</span>
1. <span class="p-yellow">core/views.py:88</span> swallows errors
2. migration <span class="p-purple">0042</span> drops a column
<span class="p-needs">Allow: pytest?  1 Yes  3 No</span>
<span class="p-muted">muted status line</span></pre>
          </div>
        </div>
      </section>
    </div>
  </div>
</div>

<style>
  .page {
    min-height: 100%;
    padding: var(--space-8) var(--space-4) var(--space-12);
    background: var(--bg);
  }

  .content {
    max-width: var(--size-page-wide);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .back {
    font-size: var(--text-md);
    text-decoration: none;
  }

  h1 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
  }

  .cols {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-8);
    align-items: flex-start;
  }

  .form {
    flex: 1 1 var(--size-column);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .colors {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .color {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2-5);
  }

  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  input[type='color'] {
    flex: none;
    width: var(--size-control-lg);
    height: var(--size-control-lg);
    padding: var(--space-1);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--panel);
    cursor: pointer;
  }

  .color.active input[type='color'] {
    border-color: var(--primary);
  }

  .label {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--muted);
  }

  .checks {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .ok {
    color: var(--status-your-turn);
  }

  .bad {
    color: var(--danger);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .preview-wrap {
    flex: 1 1 var(--size-column);

    /* Stays in view while the colour list scrolls past. */
    position: sticky;
    top: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .preview {
    display: flex;
    min-height: var(--size-preview);
    overflow: hidden;
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-lg);
    background: var(--bg);
    color: var(--fg);
    font-size: var(--text-sm);
  }

  /* Registered so it can animate; the active token points at it (see previewVars).
     A soft pulse towards the opposite colour, not a hard on/off blink. */
  @property --flash {
    syntax: '<color>';
    inherits: true;
    initial-value: transparent;
  }

  @media (prefers-reduced-motion: no-preference) {
    .preview.flashing {
      animation: flash calc(var(--duration-blink) * 0.8) ease-in-out infinite alternate;
    }
  }

  @keyframes flash {
    from {
      --flash: var(--flash-from);
    }

    to {
      --flash: var(--flash-to);
    }
  }

  .p-side {
    width: var(--size-preview-side);
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    padding: var(--space-3) var(--space-2-5);
    background: var(--panel);
  }

  .p-row {
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--fg-2);
  }

  .p-row.selected {
    background: var(--raised);
    color: var(--fg);
  }

  .p-muted {
    color: var(--muted);
  }

  .p-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .p-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border-bottom: var(--hairline) solid var(--line);
  }

  .p-term {
    flex: 1 1 auto;
    margin: 0;
    padding: var(--space-3);
    background: var(--term-bg);
    color: var(--fg-2);
    font-family: var(--font-mono);
    line-height: var(--leading-term);
    white-space: pre-wrap;
  }

  .p-accent {
    color: var(--pink);
  }

  .p-ok {
    color: var(--status-your-turn);
  }

  .p-link {
    color: var(--link);
  }

  .p-yellow {
    color: var(--yellow);
  }

  .p-purple {
    color: var(--purple);
  }

  .p-needs {
    color: var(--status-needs-you);
  }
</style>
