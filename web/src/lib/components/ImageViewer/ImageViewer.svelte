<script lang="ts">
  import IconButton from '../IconButton/IconButton.svelte';

  interface Props {
    /** Paths of the images to step through; null keeps the viewer closed. */
    paths: string[] | null;
    index: number;
    /** Image URL for `paths[index]`; null while it loads, '' when it failed. */
    src: string | null;
    onstep: (index: number) => void;
    onclose: () => void;
  }
  let { paths, index, src, onstep, onclose }: Props = $props();
  let dialog = $state<HTMLDialogElement>();
  const count = $derived(paths?.length ?? 0);

  $effect(() => {
    if (!dialog) return;
    if (paths && !dialog.open) dialog.showModal();
    if (!paths && dialog.open) dialog.close();
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft' && index > 0) onstep(index - 1);
    else if (e.key === 'ArrowRight' && index < count - 1) onstep(index + 1);
  }
</script>

<dialog
  bind:this={dialog}
  class="viewer"
  aria-label="Image"
  onclose={() => paths && onclose()}
  onclick={(e) => e.target === dialog && onclose()}
  {onkeydown}
>
  {#if paths}
    <div class="bar">
      <span class="path" title={paths[index]}>{paths[index]}</span>
      {#if count > 1}
        <IconButton
          label="Previous image"
          icon="chevron-left"
          disabled={index === 0}
          onclick={() => onstep(index - 1)}
        />
        <span class="count">{index + 1} / {count}</span>
        <IconButton
          label="Next image"
          icon="chevron-right"
          disabled={index === count - 1}
          onclick={() => onstep(index + 1)}
        />
      {/if}
      <IconButton label="Close" icon="close" onclick={onclose} />
    </div>
    {#if src}
      <img {src} alt={paths[index]} />
    {:else}
      <p class="note">{src === '' ? 'Could not load this image' : 'Loading…'}</p>
    {/if}
  {/if}
</dialog>

<style>
  .viewer {
    max-width: calc(100vw - var(--space-8));
    max-height: calc(100dvh - var(--space-8));
    padding: 0;
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-xl);
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 var(--space-6) var(--space-12) var(--shadow);
  }

  .viewer[open] {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .viewer::backdrop {
    background: var(--shadow);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
    border-bottom: var(--hairline) solid var(--line);
  }

  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    font-size: var(--text-xs);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  /* The image keeps its size up to the screen and shrinks to fit beyond it. */
  img {
    display: block;
    flex: 1 1 auto;
    min-height: 0;
    max-width: 100%;
    object-fit: contain;
  }

  .note {
    margin: 0;
    padding: var(--space-6);
    font-size: var(--text-sm);
    color: var(--muted);
  }
</style>
