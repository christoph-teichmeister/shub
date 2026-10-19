<script lang="ts">
  import { onMount } from 'svelte';
  import Toast from './lib/components/Toast/Toast.svelte';
  import { router } from './lib/stores/router.svelte.ts';
  import { app, connectEvents, loadAll, needsYouCount } from './lib/stores/state.svelte.ts';
  import Main from './lib/views/Main.svelte';
  import Placeholder from './lib/views/Placeholder.svelte';
  import Styleguide from './lib/views/Styleguide.svelte';

  onMount(() => {
    void loadAll();
    return connectEvents();
  });

  $effect(() => {
    const n = needsYouCount();
    document.title = n ? `(${n}) shub` : 'shub';
  });
</script>

{#if router.route.name === 'styleguide'}
  <Styleguide />
{:else if app.authRequired}
  <Placeholder title="Sign in" body="Open the login link from `shub login` or pair this device." />
{:else if router.route.name === 'settings'}
  <Placeholder title="Settings" body="Settings are not built yet." />
{:else}
  <Main />
{/if}
<Toast />
