<script lang="ts">
  import { onMount } from 'svelte';
  import Toast from './lib/components/Toast/Toast.svelte';
  import UpdateCurtain from './lib/components/UpdateCurtain/UpdateCurtain.svelte';
  import { select } from './lib/stores/device.ts';
  import { checkAppUpdate } from './lib/stores/loader.ts';
  import { fleet, loadMachines } from './lib/stores/machines.svelte.ts';
  import { go, router } from './lib/stores/router.svelte.ts';
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
    // A tapped notification: ?machine=<origin> (from another machine) and ?session=<id>.
    const params = new URLSearchParams(location.search);
    const machine = params.get('machine');
    const session = params.get('session');
    if (machine) select(machine);
    if (machine || session) history.replaceState(null, '', location.pathname + location.hash);
    // The loader looks at every machine for a newer app; a new one reloads the page behind the update curtain.
    const checkApp = () =>
      checkAppUpdate(fleet.list.map((m) => m.origin)).then((r) => {
        if (!r.updated || !r.version || app.reloadingTo) return;
        app.reloadingTo = r.version;
        setTimeout(() => location.reload(), 900);
      });
    void loadMachines().then(checkApp);
    const appTimer = setInterval(() => void checkApp(), 30 * 60_000);
    void loadAll().then(() => {
      const s = session ? app.sessions.find((x) => x.id === session) : undefined;
      if (s) go(...(s.projectId ? ['p', s.projectId, s.id] : ['g']));
    });
    const stopEvents = connectEvents();
    return () => (clearInterval(appTimer), stopEvents());
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
{:else if route.name === 'settings' && (ui.phone || (app.ready && !app.unreachable && app.projects.length === 0))}
  {@render settings()}
{:else if route.name !== 'settings' && app.ready && !app.unreachable && app.projects.length === 0}
  <FirstRun firstRun />
{:else if ui.phone}
  <Phone />
{:else}
  <!-- One Main for both, so switching between settings and a project keeps the sidebar mounted. -->
  <Main children={route.name === 'settings' ? settings : undefined} />
{/if}
{#if !signIn && route.name !== 'styleguide'}<Overlays />{/if}
<Toast />
<UpdateCurtain version={app.reloadingTo} />
