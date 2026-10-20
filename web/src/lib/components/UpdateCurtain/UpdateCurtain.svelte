<script lang="ts">
  import { onMount } from 'svelte';
  import { toast } from '../../stores/toasts.svelte.ts';
  import Wordmark from '../Wordmark/Wordmark.svelte';

  interface Props {
    /** Version being installed: the curtain fades in while the page reloads. */
    version?: string | null;
  }
  let { version = null }: Props = $props();

  /** Set by the page that reloaded for an update; this page starts covered and fades the curtain out. */
  let arrived = $state<string | null>(null);
  try {
    arrived = sessionStorage.getItem('shub-updated');
    sessionStorage.removeItem('shub-updated');
  } catch {}

  onMount(() => {
    if (!arrived) return;
    const v = arrived;
    // Two frames so the covered state paints before the fade starts.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        arrived = null;
        toast(`Updated to shub ${v}.`);
      }),
    );
  });

  const shown = $derived(version ?? arrived);
</script>

<div
  class="curtain"
  class:shown={!!shown}
  class:instant={!!arrived}
  aria-hidden={!shown}
  role="status"
  aria-label={version ? `Updating to ${version}` : undefined}
>
  <div class="badge"><Wordmark size="xl" needsYou /></div>
</div>

<style>
  .curtain {
    position: fixed;
    inset: 0;
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(2px);
    opacity: 0;
    visibility: hidden;
    transition:
      opacity var(--duration-slow) var(--ease-standard),
      visibility 0s linear var(--duration-slow);
  }

  .curtain.shown {
    opacity: 1;
    visibility: visible;
    transition: opacity var(--duration-slow) var(--ease-standard);
  }

  .badge {
    padding: var(--space-6) var(--space-8);
    border-radius: var(--radius-xl);
    background: var(--panel);
    box-shadow: 0 var(--space-4) var(--space-8) var(--shadow);
  }

  .curtain.instant {
    transition: none;
  }
</style>
