<script lang="ts">
  import type { ResolvedIcon } from '../../../../../shared/api.ts';
  import Icon from '../Icon/Icon.svelte';
  import { isIconName } from '../Icon/icons.ts';
  import { PROJECT_COLORS } from '../../tokens/tokens.ts';

  interface Props {
    icon: ResolvedIcon;
    /** Project name, for the fallback letter and the tooltip. */
    name: string;
    size?: 'sm' | 'md' | 'lg';
  }
  let { icon, name, size = 'md' }: Props = $props();

  /** Path of the image that failed to load; a new path gets a fresh try. */
  let failedPath = $state<string>();
  const broken = $derived(icon.kind === 'image' && failedPath === icon.path);

  /** Up to two letters: the first letters of the first two words ("ai-portal" → AP), else the first two. */
  const letters = $derived.by(() => {
    const words = name.split(/[\s._-]+/).filter(Boolean);
    return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
  });
  /** Same colour for the same name on every device, so projects without an own icon stay apart. */
  const letterColor = $derived(
    PROJECT_COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 78) % PROJECT_COLORS.length].value,
  );

  const title = $derived(
    broken
      ? `Icon could not be loaded: ${failedPath?.slice(0, 120)}\nUse a direct image URL (e.g. raw.githubusercontent.com, not a github.com/…/blob/ page) from a public source, or a data:image URL.`
      : icon.kind === 'image' || icon.kind === 'symbol'
        ? 'Custom icon'
        : undefined,
  );
</script>

<!-- Decoration next to the project name: screen readers read the name, not "AP". -->
<span
  class="tile {size}"
  class:broken
  aria-hidden={broken ? undefined : 'true'}
  {title}
  style:--tile={icon.kind === 'symbol' ? icon.color : icon.kind === 'image' ? undefined : letterColor}
>
  {#if broken}?
  {:else if icon.kind === 'image' && icon.path}<img src={icon.path} alt="" onerror={() => (failedPath = icon.path)} />
  {:else if icon.kind === 'symbol' && icon.symbol && isIconName(icon.symbol)}<Icon
      name={icon.symbol}
      size={size === 'lg' ? 'lg' : 'sm'}
      weight={1.8}
    />
  {:else}{letters}
  {/if}
</span>

<style>
  .tile {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    font-family: var(--font-mono);
    font-weight: var(--weight-bold);
    color: var(--brand-on-tile);
    background: var(--tile, var(--raised));
  }

  .sm {
    width: var(--size-tile-xs);
    height: var(--size-tile-xs);
    border-radius: var(--radius-xs);
    font-size: var(--text-3xs);
  }

  .md {
    width: var(--size-tile);
    height: var(--size-tile);
    border-radius: var(--radius-sm);
    font-size: var(--text-2xs);
  }

  .lg {
    width: var(--size-tile-lg);
    height: var(--size-tile-lg);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }

  .broken {
    color: var(--fg);
    cursor: help;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
