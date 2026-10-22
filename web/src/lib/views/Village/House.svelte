<script lang="ts">
  // A project's house: roof in the project colour, lit and smoking while a crab works (lit after dark while it has a
  // session), boarded up without one.
  import type { House } from '../../village/world.ts';

  interface Props {
    house: House;
    working: boolean;
    /** Crabs working here: each sits at a desk of its own. */
    busy: number;
    lit: boolean;
    /** The view's step counter, for the chimney smoke. */
    t: number;
    dim: number;
    onplus: () => void;
  }
  let { house, working, busy, lit, t, dim, onplus }: Props = $props();
  const url = (name: string) => `/village/${name}.svg`;
</script>

<div
  class="house"
  class:boarded={!house.active}
  style:left="{house.x}px"
  style:top="{house.y}px"
  style:z-index={house.y}
  style:opacity={dim}
>
  <span class="sprite">
    <img class="layer" src={url('house-base')} alt="" />
    {#if lit}<img class="layer" src={url('house-lit')} alt="" />{/if}
    <span class="layer roof" style:background={house.project.color}></span>
    <img class="layer" src={url('house-roof-detail')} alt="" />
    {#if !house.active}<img class="layer" src={url('boards')} alt="" />{/if}
    {#if working}
      {#each [0, 1, 2] as j (j)}
        {@const ph = (t + j * 8) % 24}
        <span
          class="puff"
          style:left="{68 + Math.round(ph * 0.7 + Math.sin(ph * 0.5) * 2)}px"
          style:top="{-4 - ph * 3}px"
          style:width="{6 + Math.floor(ph / 5) * 2}px"
          style:height="{6 + Math.floor(ph / 5) * 2}px"
          style:opacity={(1 - ph / 24) * 0.75}
        ></span>
      {/each}
    {/if}
  </span>
  <span class="plate"><i style:background={house.project.color}></i>{house.project.name}</span>
  <button
    type="button"
    class="plus"
    aria-label="New session in {house.project.name}"
    title="New session"
    onclick={onplus}>+</button
  >
</div>
{#if house.active}
  {#each house.desks as desk, i (i)}
    <img
      class="desk"
      src={url(i < busy ? 'desk-on' : 'desk-off')}
      alt=""
      style:left="{desk.x}px"
      style:top="{desk.y}px"
      style:z-index={desk.y}
      style:opacity={dim}
    />
  {/each}
{/if}

<style>
  .house {
    position: absolute;

    /* The plate hangs below the house, so the house itself ends at `top`. */
    transform: translate(-50%, calc(var(--village-px) * -46));
    display: flex;
    flex-direction: column;
    align-items: center;
    transition: opacity var(--duration-base) var(--ease-standard);
  }

  .boarded {
    filter: grayscale(0.65) brightness(0.85);
  }

  .sprite {
    position: relative;
    display: block;
    width: calc(var(--village-px) * 48);
    height: calc(var(--village-px) * 46);
  }

  .layer {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
  }

  .puff {
    position: absolute;
    background: var(--village-paper);
    box-shadow: 0 0 0 var(--village-px) var(--village-parchment-line);
    pointer-events: none;
  }

  .roof {
    mask-image: url('/village/house-roof-mask.svg');
    mask-size: 100% 100%;
  }

  .plus {
    position: absolute;
    top: var(--space-1);
    right: calc(var(--space-3) * -1);
    width: var(--size-control-md);
    height: var(--size-control-md);
    padding: 0;
    border: var(--space-0-5) solid var(--village-wood-dark);
    border-radius: var(--radius-xs);
    background: var(--village-gold);
    box-shadow: 0 var(--space-0-5) 0 var(--village-ink);
    color: var(--village-ink);
    font: var(--weight-semibold) var(--text-xl) / 1 var(--font-pixel);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }

  .plus:focus-visible {
    opacity: 1;
    outline: var(--ring) solid var(--village-gold);
    outline-offset: var(--ring);
  }

  .house:hover .plus {
    opacity: 1;
  }

  .plate {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-0-5);
    padding: var(--space-0-5) var(--space-1-5);
    border: var(--ring) solid var(--village-wood-dark);
    border-radius: var(--radius-xs);
    background: var(--village-parchment);
    color: var(--village-ink);
    font: var(--weight-semibold) var(--text-md) / 1 var(--font-pixel);
    white-space: nowrap;
  }

  .plate i {
    width: var(--size-check);
    height: var(--size-check);
    border: var(--hairline) solid var(--village-ink);
  }

  .desk {
    position: absolute;
    transform: translate(-50%, -100%);
    width: calc(var(--village-px) * 26);
    height: calc(var(--village-px) * 18);
    image-rendering: pixelated;
  }
</style>
