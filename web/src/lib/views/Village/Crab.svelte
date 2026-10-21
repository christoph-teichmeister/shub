<script lang="ts" module>
  export type Bubble = { text: string; tone: 'needs-you' | 'your-turn' | 'waiting' | 'paused' | 'angry' };
</script>

<script lang="ts">
  // One session as a crab on the map: body frame, hat in the project colour, status bubble, subagents as babies,
  // its context as a backpack (sweat, panting) and its impatience in the queue (hops, foot-tap dust).
  import type { Outfit } from '../../village/world.ts';

  interface Props {
    /** Bottom centre on the map. */
    x: number;
    y: number;
    /** -1 faces left. */
    dir: number;
    /** Body sprite, e.g. "crab-walk1". */
    body: string;
    sleeping: boolean;
    outfit: Outfit | 'mayor';
    color: string;
    bubble: Bubble | null;
    /** Body sprites of the subagent babies next to it. */
    babies: string[];
    /** Backpack size, null for none. */
    pack: 0 | 1 | 2 | null;
    sweat: boolean;
    pant: boolean;
    /** Hop height in px (impatience). */
    lift: number;
    /** Foot-tapping in the queue. */
    dust: boolean;
    /** The view's step counter, for the drops, puffs and dust. */
    t: number;
    label: string;
    describedby?: string;
    dim: number;
    /** Its card is pinned: a ring shows which crab the keys act on. */
    ring: boolean;
    onclick: () => void;
    ondblclick: () => void;
    onenter: () => void;
    onleave: () => void;
  }
  let {
    x,
    y,
    dir,
    body,
    sleeping,
    outfit,
    color,
    bubble,
    babies,
    pack,
    sweat,
    pant,
    lift,
    dust,
    t,
    label,
    describedby,
    dim,
    ring,
    onclick,
    ondblclick,
    onenter,
    onleave,
  }: Props = $props();
  const url = (name: string) => `/village/${name}.svg`;
</script>

{#snippet crab(src: string, cls: string)}
  <span class="sprite {cls}">
    <img class="layer" src={url(src)} alt="" />
    {#if outfit !== 'mayor'}
      <span class="layer hat" style:background={color} style:mask-image="url({url(`hat-${outfit}-mask`)})"></span>
    {/if}
    <img class="layer" src={url(outfit === 'mayor' ? 'hat-mayor' : `hat-${outfit}-detail`)} alt="" />
  </span>
{/snippet}

<button
  type="button"
  class="crab"
  class:sleeping
  class:ring
  style:left="{x}px"
  style:top="{y}px"
  style:z-index={Math.round(y)}
  style:opacity={dim}
  aria-label={label}
  aria-describedby={describedby}
  {onclick}
  {ondblclick}
  onmouseenter={onenter}
  onmouseleave={onleave}
  onfocus={onenter}
  onblur={onleave}
>
  {#if sleeping}<img class="lounger" src={url('lounger')} alt="" />{/if}
  {#if dust}<span class="dust" style:opacity={t % 3 === 0 ? 0.9 : 0}></span>{/if}
  <span class="lift" style:transform="translateY({lift}px)">
    {#if bubble}<span class="bubble {bubble.tone}">{bubble.text}</span>{/if}
    {#if pack !== null}<img class="pack pack{pack}" src={url(`pack${pack}`)} alt="" />{/if}
    <span class="body" style:transform="scaleX({dir})">{@render crab(body, 'big')}</span>
    {#if sweat}
      <span class="drop" style:top="{6 + ((t * 2) % 14)}px"></span>
      <span class="drop right" style:top="{6 + ((t * 2 + 7) % 14)}px"></span>
    {/if}
    {#if pant}<span class="huff" style:opacity={t % 4 < 2 ? 0.9 : 0.2}></span>{/if}
  </span>
  {#each babies as baby, i (i)}
    <span class="baby" style:left="calc(var(--village-px) * {-13 - i * 12})">{@render crab(baby, 'small')}</span>
  {/each}
</button>

<style>
  .crab {
    position: absolute;
    transform: translate(-50%, -100%);
    padding: 0;
    margin: 0;
    border: 0;
    background: none;
    line-height: 0;
    cursor: pointer;
    transition: opacity var(--duration-base) var(--ease-standard);
  }

  .crab:focus-visible {
    outline: var(--ring) solid var(--village-gold);
    outline-offset: var(--space-1);
    border-radius: var(--radius-xs);
  }

  .ring {
    outline: var(--space-1) solid var(--village-gold);
    outline-offset: var(--space-1);
    border-radius: var(--radius-xs);
  }

  .body,
  .lift {
    position: relative;
    display: block;
  }

  /* Behind the crab, on its back. */
  .pack {
    position: absolute;
    right: calc(var(--village-px) * -4);
    bottom: calc(var(--village-px) * 7);
    image-rendering: pixelated;
  }

  .pack0 {
    width: calc(var(--village-px) * 10);
    height: calc(var(--village-px) * 11);
  }

  .pack1 {
    width: calc(var(--village-px) * 12);
    height: calc(var(--village-px) * 13);
  }

  .pack2 {
    width: calc(var(--village-px) * 14);
    height: calc(var(--village-px) * 18);
  }

  .drop {
    position: absolute;
    left: calc(var(--village-px) * 4);
    width: calc(var(--village-px) * 2);
    height: calc(var(--village-px) * 3);
    background: var(--village-sky);
    box-shadow: 0 0 0 var(--hairline) var(--village-ink);
  }

  .drop.right {
    left: auto;
    right: calc(var(--village-px) * 3);
  }

  /* Panting: three puffs of breath in front of the mouth. */
  .huff {
    position: absolute;
    top: calc(var(--village-px) * 15);
    left: calc(var(--village-px) * -6);
    width: calc(var(--village-px) * 3);
    height: calc(var(--village-px) * 3);
    background: var(--village-paper);
    box-shadow:
      calc(var(--village-px) * -3) calc(var(--village-px) * -2) 0 var(--village-paper),
      calc(var(--village-px) * -5) var(--village-px) 0 var(--village-parchment);
  }

  .dust {
    position: absolute;
    bottom: calc(var(--village-px) * -1);
    left: calc(var(--village-px) * 2);
    width: calc(var(--village-px) * 3);
    height: calc(var(--village-px) * 2);
    background: var(--village-wood);
    box-shadow:
      calc(var(--village-px) * 17) 0 0 var(--village-wood),
      calc(var(--village-px) * 3) calc(var(--village-px) * -2) 0 var(--village-parchment);
  }

  .sprite {
    position: relative;
    display: block;
  }

  .sprite.big {
    width: calc(var(--village-px) * 26);
    height: calc(var(--village-px) * 26);
  }

  .sprite.small {
    width: calc(var(--village-px) * 13);
    height: calc(var(--village-px) * 13);
  }

  .layer {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
  }

  .hat {
    mask-size: 100% 100%;
  }

  /* Lying down, the hat sits lower. */
  .sleeping .sprite.big .layer:not(:first-child) {
    top: calc(var(--village-px) * 2);
  }

  .baby {
    position: absolute;
    bottom: 0;
  }

  .lounger {
    position: absolute;
    left: calc(50% - var(--village-px) * 21);
    bottom: calc(var(--village-px) * -4);
    width: calc(var(--village-px) * 34);
    height: calc(var(--village-px) * 15);
    image-rendering: pixelated;
  }

  .bubble {
    position: absolute;
    z-index: var(--z-raised);
    bottom: calc(100% - var(--space-0-5));
    left: 50%;
    transform: translateX(-50%);
    padding: var(--space-0-5) var(--space-1-5);
    border: var(--ring) solid var(--village-ink);
    border-radius: var(--radius-xs);
    box-shadow: 0 var(--ring) 0 var(--village-ink);
    color: var(--village-ink);
    font: var(--weight-semibold) var(--text-base) / 1 var(--font-pixel);
    white-space: nowrap;
  }

  .bubble.needs-you {
    background: var(--status-needs-you);
  }

  .bubble.your-turn {
    background: var(--status-your-turn);
  }

  .bubble.waiting {
    background: var(--village-sky);
  }

  .bubble.paused {
    background: var(--village-parchment);
  }

  .bubble.angry {
    background: var(--village-alarm);
    color: var(--village-paper);
  }
</style>
