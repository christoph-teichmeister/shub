<script lang="ts">
  import { parseDraft, type Span } from '../../draft.ts';

  let { md }: { md: string } = $props();
</script>

{#snippet text(parts: Span[])}
  {#each parts as p, i (i)}<svelte:element
      this={p.href ? 'a' : p.code ? 'code' : 'span'}
      class:bold={p.bold}
      class:italic={p.italic}
      class:strike={p.strike}
      href={p.href}
      target={p.href ? '_blank' : undefined}
      rel={p.href ? 'noreferrer noopener' : undefined}>{p.text}</svelte:element
    >{/each}
{/snippet}

<div class="preview" role="region" aria-label="Preview">
  {#each parseDraft(md) as b, i (i)}
    {#if b.kind === 'heading'}
      <svelte:element this={`h${b.level}`}>{@render text(b.text)}</svelte:element>
    {:else if b.kind === 'p'}
      <p>{@render text(b.text)}</p>
    {:else if b.kind === 'quote'}
      <blockquote>{@render text(b.text)}</blockquote>
    {:else if b.kind === 'code'}
      <pre><code>{b.text}</code></pre>
    {:else if b.kind === 'rule'}
      <hr />
    {:else}
      <svelte:element this={b.ordered ? 'ol' : 'ul'}>
        {#each b.items as item, j (j)}
          <li style:margin-left="{item.depth * 1.25}em" class:task={item.checked !== undefined}>
            {#if item.checked !== undefined}<span aria-hidden="true">{item.checked ? '☑' : '☐'}</span
              >{/if}{@render text(item.text)}
          </li>
        {/each}
      </svelte:element>
    {/if}
  {:else}
    <p class="empty">Nothing to preview yet.</p>
  {/each}
</div>

<style>
  .preview {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-3) var(--space-4);
    color: var(--fg);
    font-size: var(--text-base);
    line-height: 1.6;
    overflow-wrap: anywhere;
  }

  .preview :is(h1, h2, h3, h4, h5, h6) {
    margin: var(--space-4) 0 var(--space-2);
    line-height: 1.3;
  }

  .preview h1 {
    font-size: 1.6em;
  }

  .preview h2 {
    font-size: 1.35em;
  }

  .preview h3 {
    font-size: 1.15em;
  }

  .preview :is(h4, h5, h6) {
    font-size: 1em;
  }

  .preview :is(p, ul, ol, blockquote, pre) {
    margin: 0 0 var(--space-3);
  }

  .preview :is(ul, ol) {
    padding-left: var(--space-5);
  }

  .preview li.task {
    list-style: none;
    margin-left: calc(var(--space-5) * -1);
  }

  .preview li.task > span[aria-hidden] {
    margin-right: var(--space-1-5);
  }

  .preview blockquote {
    padding-left: var(--space-3);
    border-left: var(--ring) solid var(--line);
    color: var(--muted);
  }

  .preview :is(code, pre) {
    font-family: var(--font-mono);
    font-size: 0.92em;
  }

  .preview code:not(pre code) {
    padding: 0 var(--space-1);
    border-radius: var(--radius-xs);
    background: var(--bg);
  }

  .preview pre {
    padding: var(--space-2-5) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--bg);
    overflow-x: auto;
  }

  .preview hr {
    border: 0;
    border-top: var(--hairline) solid var(--line);
    margin: var(--space-4) 0;
  }

  .preview a {
    color: var(--primary);
  }

  .bold {
    font-weight: var(--weight-semibold);
  }

  .italic {
    font-style: italic;
  }

  .strike {
    text-decoration: line-through;
  }

  .empty {
    color: var(--muted);
  }
</style>
