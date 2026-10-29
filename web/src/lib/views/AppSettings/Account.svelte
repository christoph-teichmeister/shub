<script lang="ts">
  // Settings area Account & security: who is signed in, the activity log, rotating the access token.
  import type { ActivityEntry } from '../../../../../shared/api.ts';
  import Button from '../../components/Button/Button.svelte';
  import Dialog from '../../components/Dialog/Dialog.svelte';
  import Section from '../../components/Section/Section.svelte';
  import { when } from '../../format.ts';
  import { api } from '../../stores/api.ts';
  import { app } from '../../stores/state.svelte.ts';
  import { toast, toastError } from '../../stores/toasts.svelte.ts';

  let rotating = $state(false);
  let activity = $state<ActivityEntry[] | null>(null);

  async function rotate() {
    rotating = false;
    const res = await api<{ tokenFile: string }>('rotateToken').catch(toastError);
    if (res) toast(`New access token written to ${res.tokenFile}. Other devices are signed out.`, 'neutral', 8000);
  }

  async function signOut() {
    await api('logout').catch(() => {});
    location.replace('/#/login');
    location.reload();
  }

  async function showActivity() {
    activity = (await api<ActivityEntry[]>('activity', { query: { limit: '100' } }).catch(toastError)) ?? null;
  }

  async function undo(e: ActivityEntry) {
    await api('undo', { params: { id: e.id } }).then(() => toast('Undone'), toastError);
    void showActivity();
  }
</script>

<div class="card">
  <Section title="Signed in">
    <div class="row">
      <span class="avatar" aria-hidden="true">{(app.me?.name ?? 'You').slice(0, 1).toUpperCase()}</span>
      <span class="grow stack"
        ><span class="strong">{app.me?.name ?? 'You'}</span><span class="muted small">{location.host}</span></span
      >
      <Button onclick={showActivity}>Activity log</Button>
      <Button onclick={signOut}>Sign out</Button>
    </div>
  </Section>
</div>
<div class="card danger-zone">
  <Section
    title="Access token"
    description="Rotating writes a new token and signs out every other browser and phone. Session and plugin tokens keep working."
  >
    <div><Button variant="danger" onclick={() => (rotating = true)}>Rotate access token</Button></div>
  </Section>
</div>

<Dialog
  open={rotating}
  title="Rotate the access token?"
  description="A new token is written to the token file; every other browser and phone is signed out. Session and plugin tokens keep working."
  onclose={() => (rotating = false)}
>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (rotating = false)}>Cancel</Button>
    <Button variant="danger" onclick={rotate}>Rotate</Button>
  {/snippet}
</Dialog>

<Dialog
  open={!!activity}
  title="Activity log"
  description="What you, sessions and plugins changed."
  onclose={() => (activity = null)}
>
  <ul class="list log-list">
    {#each activity ?? [] as e (e.id)}
      <li class="item">
        <span class="grow stack">
          <span><span class="strong">{e.action}</span> · {e.actor}</span>
          <span class="muted small">{when(e.at)} · {e.detail}</span>
        </span>
        {#if e.undo}<Button size="sm" onclick={() => undo(e)}>Undo</Button>{/if}
      </li>
    {/each}
    {#if activity && !activity.length}<li class="muted">Nothing yet.</li>{/if}
  </ul>
</Dialog>

<style>
  .card {
    padding: var(--space-4) var(--space-5);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--panel);
  }

  .danger-zone {
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  }

  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size-control-lg);
    height: var(--size-control-lg);
    border-radius: var(--radius-round);
    background: var(--purple);
    color: var(--on-accent);
    font-weight: var(--weight-semibold);
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2-5);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .strong {
    font-weight: var(--weight-medium);
    color: var(--fg);
  }

  .muted {
    margin: 0;
    color: var(--muted);
  }

  .small {
    font-size: var(--text-sm);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2-5);
    padding: var(--space-3);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--bg);
  }

  .log-list {
    max-height: 60vh;
    overflow-y: auto;
  }
</style>
