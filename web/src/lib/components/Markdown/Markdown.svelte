<script lang="ts">
  import { parseMarkdown, type Inline } from '../../markdown.ts';

  interface Props {
    /** Release-notes Markdown: headings, "- " lists, paragraphs, `code`, PR numbers. */
    md: string;
  }
  let { md }: Props = $props();
</script>

{#snippet text(parts: Inline[])}
  {#each parts as part, i (i)}{#if part.code}<code>{part.text}</code>{:else if part.pr}<a
        href="https://github.com/christoph-teichmeister/shub/pull/{part.pr}"
        target="_blank"
        rel="noreferrer">{part.text}</a
      >{:else}{part.text}{/if}{/each}
{/snippet}

<div class="md">
  {#each parseMarkdown(md) as block, i (i)}
    {#if block.kind === 'heading'}
      <svelte:element this={`h${Math.min(block.level + 1, 6)}`}>{@render text(block.text)}</svelte:element>
    {:else if block.kind === 'list'}
      <ul>
        {#each block.items as item, j (j)}<li>{@render text(item)}</li>{/each}
      </ul>
    {:else}
      <p>{@render text(block.text)}</p>
    {/if}
  {/each}
</div>

<style>
  .md {
    font-size: var(--text-sm);
    color: var(--fg-2);
  }

  .md :is(h2, h3, h4, h5, h6) {
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--text-sm);
    color: var(--fg);
  }

  .md :is(p, ul) {
    margin: 0 0 var(--space-2);
  }

  .md ul {
    padding-left: var(--space-4);
  }

  .md code {
    font-family: var(--font-mono);
  }
</style>
