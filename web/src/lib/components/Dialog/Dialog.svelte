<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    title: string;
    description?: string;
    /** Called when the dialog closes by Escape, backdrop click or `close()`. */
    onclose: () => void;
    children?: Snippet;
    actions?: Snippet;
    /** `needs-you` draws the orange frame (approvals: a decision waits on you). */
    tone?: 'default' | 'needs-you';
  }
  let { open, title, description, onclose, children, actions, tone = 'default' }: Props = $props();
  let dialog = $state<HTMLDialogElement>();
  const id = `dialog-${Math.random().toString(36).slice(2, 8)}`;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class="dialog {tone}"
  aria-labelledby="{id}-title"
  onclose={() => open && onclose()}
  onclick={(e) => e.target === dialog && onclose()}
>
  {#if open}
    <div class="content">
      <div class="head">
        <h2 id="{id}-title" class="title">{title}</h2>
        {#if description}<p class="description">{description}</p>{/if}
      </div>
      {#if children}<div class="body">{@render children()}</div>{/if}
      {#if actions}<div class="actions">{@render actions()}</div>{/if}
    </div>
  {/if}
</dialog>

<style>
  .dialog {
    width: calc(100% - var(--space-8));
    max-width: var(--size-dialog);
    padding: 0;
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-xl);
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 var(--space-6) var(--space-12) var(--shadow);
  }

  /* A tall dialog keeps its title and buttons on screen: only the body scrolls. */
  .dialog[open] {
    display: flex;
    max-height: calc(100dvh - var(--space-8));
    overflow: hidden;
  }

  .needs-you {
    border: var(--ring) solid var(--status-needs-you);
  }

  .dialog::backdrop {
    background: var(--shadow);
  }

  .content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    gap: var(--space-4);
    padding: var(--space-6);
  }

  /* The padding keeps focus rings from being clipped by the scroll box. */
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-height: 0;
    margin: calc(-1 * var(--ring));
    padding: var(--ring);
    overflow-y: auto;
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .title {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
  }

  .description {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
