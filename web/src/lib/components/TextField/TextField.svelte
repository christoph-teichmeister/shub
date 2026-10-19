<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLInputAttributes, 'value'> {
    label: string;
    value: string | number;
    hint?: string;
    /** Paths, ports, tokens, colours. */
    mono?: boolean;
    /** Keeps the label for screen readers only. */
    hideLabel?: boolean;
    /** Renders a textarea with this many rows. */
    rows?: number;
    /** Shown in the danger colour under the field and wired to aria-invalid. */
    error?: string;
  }
  let {
    label,
    value = $bindable(),
    hint,
    mono = false,
    hideLabel = false,
    rows,
    error,
    id = `field-${Math.random().toString(36).slice(2, 8)}`,
    ...rest
  }: Props = $props();
</script>

<div class="field">
  <label for={id} class:visually-hidden={hideLabel}>{label}</label>
  {#if rows}
    <textarea
      {id}
      class="control"
      class:mono
      {rows}
      bind:value
      placeholder={rest.placeholder}
      required={rest.required}
      aria-describedby={hint || error ? `${id}-hint` : undefined}></textarea>
  {:else}
    <input
      {id}
      class="control"
      class:mono
      bind:value
      aria-invalid={error ? true : undefined}
      aria-describedby={hint || error ? `${id}-hint` : undefined}
      {...rest}
    />
  {/if}
  {#if error}<span id="{id}-hint" class="hint error" role="alert">{error}</span>
  {:else if hint}<span id="{id}-hint" class="hint">{hint}</span>{/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    min-width: 0;
  }

  label {
    font-weight: var(--weight-medium);
  }

  .control {
    height: var(--size-control-lg);
    padding: 0 var(--space-3);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--panel);
    color: var(--fg);
  }

  textarea.control {
    height: auto;
    padding: var(--space-2) var(--space-3);
    resize: vertical;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-md);
  }

  .hint {
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .error {
    color: var(--danger);
  }
</style>
