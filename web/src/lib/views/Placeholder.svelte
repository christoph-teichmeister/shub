<script lang="ts">
  import Button from '../components/Button/Button.svelte';
  import EmptyState from '../components/EmptyState/EmptyState.svelte';

  let { title, body }: { title: string; body: string } = $props();
</script>

<div class="page">
  <EmptyState {title} {body}>
    <Button onclick={() => history.back()}>Back</Button>
  </EmptyState>
</div>

<style>
  .page {
    height: 100%;
    display: flex;
  }
</style>
