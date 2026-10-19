<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    description?: string;
    /** Content at the right end of the heading row (e.g. a hint or button). */
    aside?: Snippet;
    children: Snippet;
  }
  let { title, description, aside, children }: Props = $props();
  const id = `section-${Math.random().toString(36).slice(2, 8)}`;
</script>

<section class="section" aria-labelledby={id}>
  <div class="head">
    <h2 {id}>{title}</h2>
    {#if aside}<div class="aside">{@render aside()}</div>{/if}
  </div>
  {#if description}<p class="description">{description}</p>{/if}
  {@render children()}
</section>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2-5);
    min-width: 0;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
  }

  h2 {
    flex: 1 1 auto;
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
  }

  .aside {
    display: flex;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .description {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }
</style>
