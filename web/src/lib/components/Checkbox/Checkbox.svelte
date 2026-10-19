<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLInputAttributes, 'checked' | 'type'> {
    label: string;
    checked: boolean;
    /** Muted second line. */
    hint?: string;
    hideLabel?: boolean;
  }
  let { label, checked = $bindable(), hint, hideLabel = false, ...rest }: Props = $props();
</script>

<label class="check">
  <input type="checkbox" bind:checked {...rest} />
  <span class="text" class:visually-hidden={hideLabel}>
    {label}
    {#if hint}<span class="hint">{hint}</span>{/if}
  </span>
</label>

<style>
  .check {
    display: inline-flex;
    align-items: flex-start;
    gap: var(--space-2-5);
    color: var(--fg-2);
    cursor: pointer;
  }

  input {
    flex: none;
    width: var(--size-icon-md);
    height: var(--size-icon-md);
    margin: var(--space-0-5) 0 0;
    accent-color: var(--primary);
  }

  .text {
    display: flex;
    flex-direction: column;
  }

  .hint {
    font-size: var(--text-sm);
    color: var(--muted);
  }
</style>
