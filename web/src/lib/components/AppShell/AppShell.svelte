<script lang="ts">
  import type { Snippet } from 'svelte';

  let { sidebar, children }: { sidebar: Snippet; children: Snippet } = $props();
</script>

<div class="shell">
  {@render sidebar()}
  <main class="main">{@render children()}</main>
</div>

<style>
  .shell {
    display: flex;
    height: 100%;
    background: var(--bg);
    color: var(--fg);
  }

  .main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
</style>
