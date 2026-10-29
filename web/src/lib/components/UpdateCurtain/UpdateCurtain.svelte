<script lang="ts">
  import type { ReleaseNotes } from '../../../../../shared/api.ts';
  import { api } from '../../stores/api.ts';
  import { app } from '../../stores/state.svelte.ts';
  import { toast } from '../../stores/toasts.svelte.ts';
  import Wordmark from '../Wordmark/Wordmark.svelte';
  import { store, stored } from '../../stored.ts';

  interface Props {
    /** Version being installed: the curtain fades in while the page reloads. */
    version?: string | null;
  }
  let { version = null }: Props = $props();

  /** Set by the page that reloaded for an update; this page starts covered and fades the curtain out. */
  const updated = stored('shub-updated', 'session');
  store('shub-updated', null, 'session');
  let arrived = $state(updated);

  /** Opaque while this page is still building underneath; stays through the fade-out. */
  let landing = $state(!!updated);

  /** Never trap the page behind the curtain if loading hangs or fails. */
  let gaveUp = $state(false);
  if (updated) setTimeout(() => (gaveUp = true), 5000);

  // Stay covered until the data and fonts are in, so the UI does not visibly fill in and shift;
  // two frames after that so the settled layout paints before the fade starts.
  $effect(() => {
    if (!arrived || !(app.ready || gaveUp)) return;
    const v = arrived;
    void document.fonts.ready.then(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          arrived = null;
          void releaseNotes(v).then((notes) =>
            notes ? toast(`Updated to shub ${v}.`, 'neutral', 15000, notes) : toast(`Updated to shub ${v}.`),
          );
        }),
      ),
    );
  });

  /** Notes of the releases after the version this one replaced, up to `v`; undefined when GitHub cannot be reached. */
  async function releaseNotes(v: string): Promise<string | undefined> {
    const releases = await api<ReleaseNotes[]>('changelog').catch(() => undefined);
    if (!releases?.length) return undefined;
    const from = app.update?.last?.to === v ? app.update.last.from : null;
    const at = releases.findIndex((r) => r.version === from);
    return releases
      .slice(0, at > 0 ? at : 1)
      .map((r) => `## ${r.version}\n\n${r.notes || 'No release notes.'}`)
      .join('\n\n');
  }

  const shown = $derived(version ?? arrived);
</script>

<div
  class="curtain"
  class:shown={!!shown}
  class:instant={!!arrived}
  class:landing
  ontransitionend={() => (landing = !!arrived)}
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

  /* The reloaded page is still building underneath: hide it fully, not just blurred. */
  .curtain.landing {
    background: var(--bg);
  }

  .curtain.instant {
    transition: none;
  }
</style>
