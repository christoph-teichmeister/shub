<script module lang="ts">
  /** A question before a step that ends something or starts a session: `run` goes on once the user confirms. */
  export interface Confirm {
    title: string;
    body: string;
    action: string;
    danger?: boolean;
    run: () => void;
  }
</script>

<script lang="ts">
  import Button from '../../components/Button/Button.svelte';
  import Dialog from '../../components/Dialog/Dialog.svelte';

  let { confirm = $bindable() }: { confirm: Confirm | null } = $props();
</script>

<Dialog open={!!confirm} title={confirm?.title ?? ''} description={confirm?.body} onclose={() => (confirm = null)}>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (confirm = null)}>Cancel</Button>
    <Button
      variant={confirm?.danger ? 'danger' : 'primary'}
      onclick={() => {
        confirm?.run();
        confirm = null;
      }}>{confirm?.action}</Button
    >
  {/snippet}
</Dialog>
