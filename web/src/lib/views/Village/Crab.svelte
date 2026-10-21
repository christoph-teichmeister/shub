<script lang="ts" module>
  export type Bubble = { text: string; tone: 'needs-you' | 'your-turn' | 'waiting' | 'paused' };
</script>

<script lang="ts">
  // One session as a crab on the map: body frame, hat in the project colour, status bubble, subagents as babies.
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
    label: string;
    describedby?: string;
    dim: number;
    onclick: () => void;
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
    label,
    describedby,
    dim,
    onclick,
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
  style:left="{x}px"
  style:top="{y}px"
  style:z-index={Math.round(y)}
  style:opacity={dim}
  aria-label={label}
  aria-describedby={describedby}
  {onclick}
  onmouseenter={onenter}
  onmouseleave={onleave}
  onfocus={onenter}
  onblur={onleave}
>
  {#if sleeping}<img class="lounger" src={url('lounger')} alt="" />{/if}
  {#if bubble}<span class="bubble {bubble.tone}">{bubble.text}</span>{/if}
  <span class="body" style:transform="scaleX({dir})">{@render crab(body, 'big')}</span>
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

  .body {
    display: block;
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
</style>
