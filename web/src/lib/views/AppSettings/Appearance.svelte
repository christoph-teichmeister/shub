<script lang="ts">
  // Settings area Appearance: the theme, and how terminals look on all devices or only this one.
  import { terminalSettingsError, type Config, type TerminalSettings } from '../../../../../shared/api.ts';
  import Button from '../../components/Button/Button.svelte';
  import Checkbox from '../../components/Checkbox/Checkbox.svelte';
  import ChoiceButton from '../../components/ChoiceButton/ChoiceButton.svelte';
  import Section from '../../components/Section/Section.svelte';
  import SelectField from '../../components/SelectField/SelectField.svelte';
  import TextField from '../../components/TextField/TextField.svelte';
  import { api } from '../../stores/api.ts';
  import { href } from '../../stores/router.svelte.ts';
  import { app, deviceTerminal, loadConfig, setDeviceTerminal, terminalSettings } from '../../stores/state.svelte.ts';
  import { toastError } from '../../stores/toasts.svelte.ts';
  import { applyTheme, BUILT_IN_THEMES, resolveTokens } from '../../tokens/tokens.ts';

  const CURSORS = [
    { value: 'underline', label: 'Underline' },
    { value: 'block', label: 'Block' },
    { value: 'bar', label: 'Bar' },
  ];
  const WEIGHTS = [
    { value: 'normal', label: 'Normal' },
    { value: 'bold', label: 'Bold' },
  ];

  const terminal = $derived(terminalSettings());
  /** Fields the reset button clears: this device's own, or the shared ones. */
  const terminalOwn = $derived(deviceTerminal.value ?? app.config?.terminal ?? {});

  const themes = $derived([...BUILT_IN_THEMES, ...(app.config?.themes ?? []).filter((t) => !t.builtIn)]);
  const active = $derived(app.config?.activeTheme ?? 'monokai');

  async function useTheme(id: string) {
    const t = themes.find((x) => x.id === id);
    if (t) applyTheme(t);
    const config = await api<Config>('settings', { body: { activeTheme: id } }).catch(toastError);
    if (config) app.config = config;
  }

  /** null resets a field (to the shared value on a device with its own settings, else to the default). */
  async function setTerminal(patch: { [K in keyof TerminalSettings]?: TerminalSettings[K] | null }) {
    if (deviceTerminal.value) {
      const error = terminalSettingsError(patch);
      if (error) return toastError(new Error(error));
      const own: Record<string, unknown> = { ...deviceTerminal.value, ...patch };
      for (const k of Object.keys(own)) if (own[k] === null) delete own[k];
      return setDeviceTerminal(own);
    }
    const config = await api<Config>('settings', { body: { terminal: patch } }).catch(toastError);
    if (config) app.config = config;
    else void loadConfig();
  }
  const numberInput = (key: 'fontSize' | 'lineHeight' | 'letterSpacing' | 'scrollback') => (e: Event) => {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
    void setTerminal({ [key]: Number.isNaN(v) ? null : v });
  };

  const swatches = (id: string) => {
    const t = resolveTokens(themes.find((x) => x.id === id) ?? BUILT_IN_THEMES[0]);
    return [t.bg, t.panel, t.primary, t.pink, t['status-working'], t['status-your-turn']];
  };
</script>

<div class="card">
  <Section title="Theme" description="The terminal uses the same palette.">
    {#snippet aside()}<a href={href('settings', 'theme', 'new')}>+ New theme</a>{/snippet}
    <div class="row" role="group" aria-label="Theme">
      {#each themes as t (t.id)}
        <ChoiceButton shape="card" pressed={t.id === active} onclick={() => useTheme(t.id)}>
          <span class="swatches" aria-hidden="true">
            {#each swatches(t.id) as c, i (i)}<span class="sw" style:--sw={c}></span>{/each}
          </span>
          {t.name}
          {#if !t.builtIn}<span class="muted small">custom</span>{/if}
        </ChoiceButton>
      {/each}
    </div>
    {#if themes.some((t) => !t.builtIn)}
      <div class="row small">
        Edit:
        {#each themes.filter((t) => !t.builtIn) as t (t.id)}<a href={href('settings', 'theme', t.id)}>{t.name}</a
          >{/each}
      </div>
    {/if}
  </Section>
</div>

<div class="card">
  <Section title="Terminal">
    {#snippet aside()}
      <span class="segment" role="group" aria-label="Terminal settings apply to">
        <span>Applies to</span>
        <ChoiceButton pressed={!deviceTerminal.value} onclick={() => setDeviceTerminal(null)}>All devices</ChoiceButton>
        <ChoiceButton pressed={!!deviceTerminal.value} onclick={() => deviceTerminal.value || setDeviceTerminal({})}
          >This device only</ChoiceButton
        >
      </span>
    {/snippet}
    <p class="muted small">
      {deviceTerminal.value
        ? 'Changes stay in this browser. Fields you have not changed follow the settings of all devices.'
        : 'Changes apply on every device. Pick "This device only" to give this browser, e.g. the phone, its own font or size.'}
    </p>
    <div class="split">
      <div class="stack gap fields">
        <TextField
          label="Font"
          hint="CSS font list, first installed one wins. The font must be installed on the device that shows the terminal."
          mono
          value={terminal.fontFamily}
          maxlength={200}
          autocomplete="off"
          onchange={(e) => setTerminal({ fontFamily: e.currentTarget.value.trim() || null })}
        />
        <div class="row end">
          <TextField
            label="Size (px)"
            type="number"
            min="6"
            max="40"
            step="1"
            value={terminal.fontSize}
            onchange={numberInput('fontSize')}
          />
          <SelectField
            label="Cursor"
            bind:value={
              () => terminal.cursorStyle, (v) => setTerminal({ cursorStyle: v as TerminalSettings['cursorStyle'] })
            }
            options={CURSORS}
          />
          <Checkbox
            label="Blinking cursor"
            checked={terminal.cursorBlink}
            onchange={(e) => setTerminal({ cursorBlink: e.currentTarget.checked })}
          />
        </div>
        <TextField
          label="Scrollback (lines)"
          type="number"
          min="0"
          max="100000"
          step="500"
          value={terminal.scrollback}
          onchange={numberInput('scrollback')}
        />
        <details class="more">
          <summary>Fine tuning: fallback font, line height, spacing, weight</summary>
          <div class="stack gap">
            <TextField
              label="Fallback font"
              hint="Used on devices that have none of the fonts above, e.g. the phone. Keep a generic name like monospace at the end."
              mono
              value={terminal.fallbackFont}
              maxlength={200}
              autocomplete="off"
              onchange={(e) => setTerminal({ fallbackFont: e.currentTarget.value.trim() || null })}
            />
            <div class="row end">
              <TextField
                label="Line height"
                type="number"
                min="1"
                max="2"
                step="0.05"
                value={terminal.lineHeight}
                onchange={numberInput('lineHeight')}
              />
              <TextField
                label="Letter spacing (px)"
                type="number"
                min="-2"
                max="10"
                step="0.5"
                value={terminal.letterSpacing}
                onchange={numberInput('letterSpacing')}
              />
              <SelectField
                label="Weight"
                bind:value={
                  () => terminal.fontWeight, (v) => setTerminal({ fontWeight: v as TerminalSettings['fontWeight'] })
                }
                options={WEIGHTS}
              />
            </div>
          </div>
        </details>
      </div>
      <div class="stack gap preview">
        <span class="muted small">Preview</span>
        <pre
          class="term-sample"
          aria-label="Font sample"
          style:font-family="{terminal.fontFamily}, {terminal.fallbackFont}"
          style:font-size="{terminal.fontSize}px"
          style:font-weight={terminal.fontWeight}
          style:line-height={terminal.lineHeight}
          style:letter-spacing="{terminal.letterSpacing}px">~/shub $ git status{'\n'}0O 1lI {'{}'} [] =&gt; != ─┬─│</pre>
        {#if Object.keys(terminalOwn).length}
          <div>
            <Button
              size="sm"
              onclick={() => setTerminal(Object.fromEntries(Object.keys(terminalOwn).map((k) => [k, null])))}
              >{deviceTerminal.value ? 'Reset to shared' : 'Reset to defaults'}</Button
            >
          </div>
        {/if}
      </div>
    </div>
  </Section>
</div>

<style>
  .card {
    padding: var(--space-4) var(--space-5);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--panel);
  }

  .segment {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .split {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5) var(--space-8);
    align-items: flex-start;
  }

  .fields {
    flex: 1 1 var(--size-preview);
    min-width: 0;
  }

  .preview {
    flex: 1 1 var(--size-column);
    min-width: 0;
  }

  .more summary {
    color: var(--link);
    font-size: var(--text-md);
    cursor: pointer;
  }

  .more[open] summary {
    margin-bottom: var(--space-2-5);
  }

  .end {
    align-items: flex-end;
  }

  .term-sample {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--term-bg);
    color: var(--term-fg);
    overflow-x: auto;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2-5);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .gap {
    gap: var(--space-2-5);
  }

  .muted {
    margin: 0;
    color: var(--muted);
  }

  .small {
    font-size: var(--text-sm);
  }

  .swatches {
    display: inline-flex;
  }

  .sw {
    width: var(--space-3);
    height: var(--space-6);
    background: var(--sw);
  }

  .sw:first-child {
    border-radius: var(--radius-xs) 0 0 var(--radius-xs);
  }

  .sw:last-child {
    border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
  }
</style>
