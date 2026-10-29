<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import Button from './lib/components/Button/Button.svelte';
  import EmptyState from './lib/components/EmptyState/EmptyState.svelte';
  import Toast from './lib/components/Toast/Toast.svelte';
  import UpdateCurtain from './lib/components/UpdateCurtain/UpdateCurtain.svelte';
  import { api } from './lib/stores/api.ts';
  import { select } from './lib/stores/device.ts';
  import { checkAppUpdate } from './lib/stores/loader.ts';
  import { fleet, loadMachines } from './lib/stores/machines.svelte.ts';
  import { go, router } from './lib/stores/router.svelte.ts';
  import {
    app,
    connectEvents,
    loadAll,
    loadChildren,
    needsYouCount,
    reloadForUpdate,
    ui,
  } from './lib/stores/state.svelte.ts';
  import Login from './lib/views/Login.svelte';
  import Main from './lib/views/Main.svelte';
  import Overlays from './lib/views/Overlays.svelte';
  import Phone from './lib/views/Phone.svelte';

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
      checkAppUpdate(fleet.list.map((m) => m.origin)).then((r) => r.updated && r.version && reloadForUpdate(r.version));
    // The loader also announces an install it made on its own (another tab's check, a page navigation).
    const onLoader = (e: MessageEvent) =>
      e.data?.type === 'app-updated' && e.data.version && reloadForUpdate(e.data.version);
    navigator.serviceWorker?.addEventListener('message', onLoader);
    void loadMachines().then(checkApp);
    const appTimer = setInterval(() => void checkApp(), 30 * 60_000);
    // Child worktrees: busy ends when a headless run goes quiet, merged needs a fetch now and then.
    // ponytail: polls even when no child exists; skip when app.children is empty if it ever costs.
    let ticks = 0;
    const childTimer = setInterval(() => void loadChildren(++ticks % 20 === 0), 30_000);
    void loadAll().then(() => {
      const s = session ? app.sessions.find((x) => x.id === session) : undefined;
      if (s) go(...(s.projectId ? ['p', s.projectId, s.id] : ['g']));
    });
    const stopEvents = connectEvents();
    // The desktop UI tells the server it is in use (window focused, input in the last 5 min): the phone gets no push then.
    let lastInput = Date.now();
    const onInput = () => (lastInput = Date.now());
    const events = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const;
    for (const e of events) addEventListener(e, onInput, { passive: true });
    const beat = () =>
      !ui.phone && document.hasFocus() && Date.now() - lastInput < 5 * 60_000 && void api('presence').catch(() => {});
    const beatTimer = setInterval(beat, 30_000);
    beat();
    return () => (
      clearInterval(beatTimer),
      events.forEach((e) => removeEventListener(e, onInput)),
      clearInterval(appTimer),
      clearInterval(childTimer),
      stopEvents(),
      navigator.serviceWorker?.removeEventListener('message', onLoader)
    );
  });

  $effect(() => {
    const n = needsYouCount();
    document.title = n ? `(${n}) shub` : 'shub';
  });
</script>

<!-- Views off the everyday path load on demand: own chunks, which the loader bundle carries offline too. -->
{#snippet lazy(view: Promise<{ default: Component<any> }>, props: Record<string, unknown> = {})}
  {#await view then { default: View }}<View {...props} />{:catch}
    <!-- A chunk that did not arrive (offline without the bundle, or gone after an update). -->
    <EmptyState title="This view did not load" body="Reload to try again.">
      <Button variant="primary" onclick={() => location.reload()}>Reload</Button>
    </EmptyState>
  {/await}
{/snippet}

{#snippet settings()}
  {#if route.name !== 'settings'}{:else if route.rest[0] === 'project' && route.rest[1]}
    {#key route.rest[1]}{@render lazy(import('./lib/views/ProjectSettings.svelte'), { id: route.rest[1] })}{/key}
  {:else if route.rest[0] === 'theme'}
    {#key route.rest[1]}{@render lazy(import('./lib/views/ThemeEditor.svelte'), { id: route.rest[1] ?? 'new' })}{/key}
  {:else if route.rest[0] === 'import'}
    {@render lazy(import('./lib/views/FirstRun.svelte'))}
  {:else}
    {@render lazy(import('./lib/views/AppSettings.svelte'))}
  {/if}
{/snippet}

{#if route.name === 'styleguide'}
  {@render lazy(import('./lib/views/Styleguide.svelte'))}
{:else if signIn}
  <Login pairCode={route.name === 'pair' ? route.code : undefined} />
{:else if route.name === 'settings' && (ui.phone || (app.ready && !app.unreachable && app.projects.length === 0))}
  {@render settings()}
{:else if route.name !== 'settings' && app.ready && !app.unreachable && app.projects.length === 0}
  {@render lazy(import('./lib/views/FirstRun.svelte'), { firstRun: true })}
{:else if route.name === 'village' && !ui.phone}
  {@render lazy(import('./lib/views/Village/Village.svelte'))}
{:else if ui.phone}
  <Phone />
{:else}
  <!-- One Main for both, so switching between settings and a project keeps the sidebar mounted. -->
  <Main children={route.name === 'settings' ? settings : undefined} />
{/if}
{#if !signIn && route.name !== 'styleguide'}<Overlays />{/if}
<Toast />
<UpdateCurtain version={app.reloadingTo} />
