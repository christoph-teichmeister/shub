<script lang="ts">
  import { onMount } from 'svelte';
  import Toast from './lib/components/Toast/Toast.svelte';
  import { router } from './lib/stores/router.svelte.ts';
  import { app, connectEvents, loadAll, needsYouCount, ui } from './lib/stores/state.svelte.ts';
  import AppSettings from './lib/views/AppSettings.svelte';
  import FirstRun from './lib/views/FirstRun.svelte';
  import Login from './lib/views/Login.svelte';
  import Main from './lib/views/Main.svelte';
  import Overlays from './lib/views/Overlays.svelte';
  import Phone from './lib/views/Phone.svelte';
  import ProjectSettings from './lib/views/ProjectSettings.svelte';
  import Styleguide from './lib/views/Styleguide.svelte';
  import ThemeEditor from './lib/views/ThemeEditor.svelte';

  const route = $derived(router.route);
  const signIn = $derived(route.name === 'pair' || route.name === 'login' || app.authRequired);

  onMount(() => {
    if (route.name === 'pair' || route.name === 'login') return;
    void loadAll();
    return connectEvents();
  });

  $effect(() => {
    const n = needsYouCount();
    document.title = n ? `(${n}) shub` : 'shub';
  });
</script>

{#snippet settings()}
  {#if route.name !== 'settings'}{:else if route.rest[0] === 'project' && route.rest[1]}
    {#key route.rest[1]}<ProjectSettings id={route.rest[1]} />{/key}
  {:else if route.rest[0] === 'theme'}
    {#key route.rest[1]}<ThemeEditor id={route.rest[1] ?? 'new'} />{/key}
  {:else if route.rest[0] === 'import'}
    <FirstRun />
  {:else}
    <AppSettings />
  {/if}
{/snippet}

{#if route.name === 'styleguide'}
  <Styleguide />
{:else if signIn}
  <Login pairCode={route.name === 'pair' ? route.code : undefined} />
{:else if route.name === 'settings' && (ui.phone || (app.ready && app.projects.length === 0))}
  {@render settings()}
{:else if route.name !== 'settings' && app.ready && app.projects.length === 0}
  <FirstRun firstRun />
{:else if ui.phone}
  <Phone />
{:else}
  <!-- One Main for both, so switching between settings and a project keeps the sidebar mounted. -->
  <Main children={route.name === 'settings' ? settings : undefined} />
{/if}
{#if !signIn && route.name !== 'styleguide'}<Overlays />{/if}
<Toast />
