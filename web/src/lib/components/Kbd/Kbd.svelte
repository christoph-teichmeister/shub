<script lang="ts">
  let { keys }: { keys: string } = $props();
</script>

<kbd class="kbd">{keys}</kbd>

<style>
  .kbd {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: var(--space-0-5) var(--space-1-5);
    border-radius: var(--radius-xs);
    background: var(--raised);
    color: var(--fg-2);
    white-space: nowrap;
  }
</style>
