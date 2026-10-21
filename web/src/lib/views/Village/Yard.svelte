<script lang="ts">
  // Beside a house: its worktrees as tents (a background agent's with a crab in front) and the Docker services of
  // one of its sessions as machines, smoking while up, with a blinking alarm while down.
  import type { ChildWorktree, ServiceContainer } from '../../../../../shared/api.ts';
  import { childLabel } from '../../children.ts';
  import { api } from '../../stores/api.ts';
  import { app } from '../../stores/state.svelte.ts';
  import { machineSpot, MAX_MACHINES, MAX_TENTS, tentSpot, type House } from '../../village/world.ts';

  interface Props {
    house: House;
    worktrees: ChildWorktree[];
    /** The session whose services the machines show; null for none. */
    sessionId: string | null;
    t: number;
    dim: number;
  }
  let { house, worktrees, sessionId, t, dim }: Props = $props();
  const url = (name: string) => `/village/${name}.svg`;

  let services = $state<ServiceContainer[]>([]);
  // Like Main's services panel: refetched when the server says they changed.
  $effect(() => {
    const id = sessionId;
    void (id && app.servicesVersion[id]);
    if (!id) {
      services = [];
      return;
    }
    api<ServiceContainer[]>('services', { params: { id } }).then(
      (list) => (services = list),
      () => (services = []),
    );
  });

  const stale = (w: ChildWorktree) => w.state === 'merged' || w.state === 'remote-gone' || w.state === 'folder-gone';
  const agent = (w: ChildWorktree) => w.name.startsWith('agent-');
  // Busy and fresh ones first, the faded ones last; past the limit they would stand on the neighbours.
  const tents = $derived(
    [...worktrees]
      .sort((a, b) => +b.busy - +a.busy || +stale(a) - +stale(b))
      .slice(0, MAX_TENTS)
      .map((w, i) => {
        const origin = app.sessions.find((s) => s.id === w.originSessionId)?.name;
        const title = `Worktree ${w.branch || w.name} (${childLabel(w)}), from ${origin ? `"${origin}"` : 'a closed session'}`;
        return { w, title, ...tentSpot(house, i) };
      }),
  );
  const machines = $derived(
    [...services]
      .sort((a, b) => +(a.state === 'running') - +(b.state === 'running'))
      .slice(0, MAX_MACHINES)
      .map((c, i) => ({ c, up: c.state === 'running', ...machineSpot(house, i) })),
  );
</script>

{#each tents as tn, i (tn.w.path)}
  <div
    class="thing tent"
    class:stale={stale(tn.w)}
    role="img"
    aria-label={tn.title}
    title={tn.title}
    style:left="{tn.x}px"
    style:top="{tn.y}px"
    style:z-index={tn.y}
    style:opacity={dim}
  >
    <img src={url('tent')} alt="" />
    <span class="flag" style:background={house.project.color}></span>
    {#if agent(tn.w)}
      <span class="agent">
        <img class="layer" src={url(tn.w.busy ? `crab-work${(t + i) % 2}` : 'crab-idle0')} alt="" />
        <span
          class="layer hat"
          style:background={house.project.color}
          style:mask-image="url({url(`hat-${house.district.outfit}-mask`)})"
        ></span>
        <img class="layer" src={url(`hat-${house.district.outfit}-detail`)} alt="" />
      </span>
    {/if}
  </div>
{/each}
{#each machines as m, i (m.c.id)}
  {@const title = `${m.c.name}: ${m.c.status || m.c.state}`}
  {@const ph = (t + i * 6) % 18}
  <div
    class="thing machine"
    role="img"
    aria-label={title}
    {title}
    style:left="{m.x}px"
    style:top="{m.y}px"
    style:z-index={m.y}
    style:opacity={dim}
  >
    <img src={url(m.up ? 'machine-up' : 'machine-down')} alt="" />
    {#if m.up}
      <span
        class="puff"
        style:left="{22 + Math.round(ph * 0.3)}px"
        style:top="{-2 - ph * 2}px"
        style:opacity={(1 - ph / 18) * 0.7}
      ></span>
    {:else}
      <span class="alarm" style:opacity={t % 4 < 2 ? 1 : 0.25}></span>
    {/if}
  </div>
{/each}

<style>
  .thing {
    position: absolute;
    transform: translate(-50%, -100%);
    line-height: 0;
    transition: opacity var(--duration-base) var(--ease-standard);
  }

  .thing img {
    image-rendering: pixelated;
  }

  .tent > img {
    width: calc(var(--village-px) * 28);
    height: calc(var(--village-px) * 22);
  }

  .flag {
    position: absolute;
    top: calc(var(--village-px) * -2);
    left: calc(var(--village-px) * 14);
    width: calc(var(--village-px) * 6);
    height: calc(var(--village-px) * 4);
    border: var(--village-px) solid var(--village-ink);
  }

  /* Merged, or the branch is gone upstream: nearly packed up. */
  .stale {
    filter: grayscale(0.7) brightness(0.9);
  }

  .stale > img,
  .stale .flag {
    opacity: 0.55;
  }

  .agent {
    position: absolute;
    bottom: calc(var(--village-px) * -2);
    left: calc(var(--village-px) * 10);
    width: calc(var(--village-px) * 13);
    height: calc(var(--village-px) * 13);
  }

  .layer {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }

  .hat {
    mask-size: 100% 100%;
  }

  .machine > img {
    width: calc(var(--village-px) * 18);
    height: calc(var(--village-px) * 18);
  }

  .puff {
    position: absolute;
    width: calc(var(--village-px) * 3);
    height: calc(var(--village-px) * 3);
    background: var(--village-paper);
    box-shadow: 0 0 0 var(--village-px) var(--village-parchment-line);
    pointer-events: none;
  }

  .alarm {
    position: absolute;
    top: calc(var(--village-px) * 7);
    left: calc(var(--village-px) * 12);
    width: calc(var(--village-px) * 4);
    height: calc(var(--village-px) * 4);
    background: var(--village-alarm);
    box-shadow:
      0 0 0 var(--village-px) var(--village-ink),
      0 0 calc(var(--village-px) * 6) calc(var(--village-px) * 2) var(--village-alarm);
  }
</style>
