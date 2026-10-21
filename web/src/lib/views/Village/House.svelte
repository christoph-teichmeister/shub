<script lang="ts">
  // A project's house: roof in the project colour, lit while a crab works, boarded up without a session.
  import type { House } from '../../village/world.ts';

  let { house, working, dim }: { house: House; working: boolean; dim: number } = $props();
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
    {#if working}<img class="layer" src={url('house-lit')} alt="" />{/if}
    <span class="layer roof" style:background={house.project.color}></span>
    <img class="layer" src={url('house-roof-detail')} alt="" />
    {#if !house.active}<img class="layer" src={url('boards')} alt="" />{/if}
  </span>
  <span class="plate"><i style:background={house.project.color}></i>{house.project.name}</span>
</div>
{#if house.active}
  <img
    class="desk"
    src={url(working ? 'desk-on' : 'desk-off')}
    alt=""
    style:left="{house.desk.x}px"
    style:top="{house.desk.y}px"
    style:z-index={house.desk.y}
    style:opacity={dim}
  />
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

  .roof {
    mask-image: url('/village/house-roof-mask.svg');
    mask-size: 100% 100%;
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
