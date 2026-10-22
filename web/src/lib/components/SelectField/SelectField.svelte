<script lang="ts">
  import type { HTMLSelectAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLSelectAttributes, 'value' | 'size'> {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    hint?: string;
    hideLabel?: boolean;
    size?: 'sm' | 'md';
  }
  let {
    label,
    value = $bindable(),
    options,
    hint,
    hideLabel = false,
    size = 'md',
    id = `select-${Math.random().toString(36).slice(2, 8)}`,
    ...rest
  }: Props = $props();
</script>

<div class="field">
  <label for={id} class:visually-hidden={hideLabel}>{label}</label>
  <select {id} class="control {size}" bind:value aria-describedby={hint ? `${id}-hint` : undefined} {...rest}>
    {#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
  </select>
  {#if hint}<span id="{id}-hint" class="hint">{hint}</span>{/if}
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
    padding: 0 var(--space-2-5);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--panel);
    color: var(--fg);

    /* custom chevron so it sits inset from the border (native arrow hugs the edge) */
    appearance: none;
    padding-right: var(--space-8);
    background-image:
      linear-gradient(45deg, transparent 50%, var(--muted) 50%),
      linear-gradient(135deg, var(--muted) 50%, transparent 50%);
    background-position:
      calc(100% - var(--space-4) - 3px) 50%,
      calc(100% - var(--space-4)) 50%;
    background-size: 4px 4px;
    background-repeat: no-repeat;
  }

  .sm {
    height: var(--size-control-sm);
    padding: 0 var(--space-6) 0 var(--space-1-5);
    border-radius: var(--radius-sm);
    font-size: var(--text-md);
  }

  .hint {
    font-size: var(--text-sm);
    color: var(--muted);
  }
</style>
