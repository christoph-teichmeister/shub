<script lang="ts">
  // The village's weather and wildlife over the map: lantern posts, pond sparkles and ducks, dew in the morning,
  // butterflies, birds and cloud shadows by day, and after dark a tint, glowing lanterns and windows, fireflies.
  // Nothing here catches the mouse.
  import {
    ambientSpots,
    birds,
    butterflies,
    clouds,
    dewFrame,
    ducks,
    fireflyFrame,
    isDark,
    pondSparkles,
    type TimeOfDay,
  } from '../../village/ambience.ts';
  import type { Point, World } from '../../village/world.ts';

  interface Props {
    world: World;
    tod: TimeOfDay;
    t: number;
    /** Centres of the glows of lit windows and your desk lamp. */
    lights: Point[];
  }
  let { world, tod, t, lights }: Props = $props();
  const url = (name: string) => `/village/${name}.svg`;

  const spots = $derived(ambientSpots(world));
  const dark = $derived(isDark(tod));
  const glows = $derived(dark ? [...world.lanterns.map(([x, y]): Point => [x, y - 40]), ...lights] : []);
</script>

{#each world.lanterns as [x, y], i (i)}
  <img class="thing lantern" src={url('lantern')} alt="" style:left="{x}px" style:top="{y}px" style:z-index={y} />
{/each}
{#each pondSparkles(world, t) as s, i (i)}
  <span class="sparkle" style:left="{s.x}px" style:top="{s.y}px" style:opacity={s.on ? 1 : 0}></span>
{/each}
{#if tod === 'morning'}
  {#each dewFrame(spots.dew, t) as s, i (i)}
    <span class="sparkle dew" style:left="{s.x}px" style:top="{s.y}px" style:opacity={s.on ? 0.9 : 0}></span>
  {/each}
{/if}
{#each ducks(world, t) as d, i (i)}
  <img
    class="thing duck"
    src={url(d.src)}
    alt=""
    style:left="{d.x}px"
    style:top="{d.y}px"
    style:transform="translate(-50%, -100%) scaleX({d.dir})"
  />
{/each}
{#if tod !== 'night'}
  {#each butterflies(world, t) as f, i (i)}
    <img class="thing fly" src={url(f.src)} alt="" style:left="{f.x}px" style:top="{f.y}px" />
  {/each}
  {#each clouds(world, t) as c, i (i)}
    <span class="cloud" style:left="{c.x}px" style:top="{c.y}px" style:width="{c.w}px" style:height="{c.h}px"></span>
  {/each}
{/if}
{#if tod !== 'day'}
  <span class="tint {tod}"></span>
{/if}
{#each glows as [x, y], i (i)}
  <span class="glow" class:bright={tod === 'night'} style:left="{x}px" style:top="{y}px"></span>
{/each}
{#if dark}
  {#each fireflyFrame(spots.fireflies, tod, t) as f, i (i)}
    <span class="firefly" style:left="{f.x}px" style:top="{f.y}px" style:opacity={f.on ? 1 : 0.2}></span>
  {/each}
{:else}
  {#each birds(world, t) as b, i (i)}
    <img class="thing bird" src={url(b.src)} alt="" style:left="{b.x}px" style:top="{b.y}px" />
  {/each}
{/if}

<style>
  /* Above every object on the map (their z-index is their y), in this order. */
  .thing,
  .sparkle,
  .cloud,
  .tint,
  .glow,
  .firefly {
    position: absolute;
    pointer-events: none;
  }

  .thing {
    transform: translate(-50%, -100%);
    image-rendering: pixelated;
  }

  .lantern {
    width: calc(var(--village-px) * 9);
    height: calc(var(--village-px) * 24);
  }

  .sparkle {
    z-index: 4;
    width: calc(var(--village-px) * 2);
    height: calc(var(--village-px) * 2);
    background: var(--village-paper);
    box-shadow:
      calc(var(--village-px) * 2) calc(var(--village-px) * 2) 0 var(--village-sky),
      calc(var(--village-px) * -2) calc(var(--village-px) * 2) 0 var(--village-sky);
  }

  /* On the grass, under houses and trees. */
  .dew {
    z-index: 3;
  }

  .duck {
    z-index: 4;
    width: calc(var(--village-px) * 14);
    height: calc(var(--village-px) * 11);
  }

  .fly {
    z-index: 100000;
    width: calc(var(--village-px) * 9);
    height: calc(var(--village-px) * 7);
  }

  .cloud {
    z-index: 100001;
    border-radius: var(--radius-round);
    background: var(--village-cloud);
  }

  .tint {
    inset: 0;
    z-index: 100002;
  }

  .tint.morning {
    background: var(--village-tint-morning);
  }

  .tint.evening {
    background: var(--village-tint-evening);
  }

  .tint.night {
    background: var(--village-tint-night);
  }

  .glow {
    z-index: 100003;
    width: calc(var(--village-px) * 70);
    height: calc(var(--village-px) * 70);
    transform: translate(-50%, -50%);
    border-radius: var(--radius-round);
    background: radial-gradient(circle, var(--village-glow) 0, transparent 70%);
    mix-blend-mode: screen;
    opacity: 0.6;
  }

  .glow.bright {
    opacity: 0.95;
  }

  .firefly {
    z-index: 100004;
    width: calc(var(--village-px) * 2);
    height: calc(var(--village-px) * 2);
    background: var(--village-firefly);
    box-shadow: 0 0 calc(var(--village-px) * 4) calc(var(--village-px) * 1.5)
      color-mix(in srgb, var(--village-firefly) 70%, transparent);
  }

  .bird {
    z-index: 100005;
    width: calc(var(--village-px) * 11);
    height: calc(var(--village-px) * 6);
  }
</style>
