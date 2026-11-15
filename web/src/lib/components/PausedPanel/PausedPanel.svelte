<script lang="ts">
  import type { Session } from '../../../../../shared/api.ts';
  import { api } from '../../stores/api.ts';
  import { toastError } from '../../stores/toasts.svelte.ts';
  import Button from '../Button/Button.svelte';
  import EmptyState from '../EmptyState/EmptyState.svelte';

  let { session }: { session: Session } = $props();
</script>

<EmptyState title="This session is paused" body="Claude is stopped; the conversation is kept.">
  <Button variant="primary" onclick={() => void api('sessionResume', { params: { id: session.id } }).catch(toastError)}
    >Resume</Button
  >
</EmptyState>
