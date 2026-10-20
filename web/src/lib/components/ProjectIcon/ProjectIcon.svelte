<script lang="ts">
  import type { ResolvedIcon } from '../../../../../shared/api.ts';
  import Icon from '../Icon/Icon.svelte';
  import { isIconName } from '../Icon/icons.ts';
  import { LOGOS } from './logos.ts';

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

  const title = $derived(
    broken
      ? `Icon could not be loaded: ${failedPath?.slice(0, 120)}\nUse a direct image URL (e.g. raw.githubusercontent.com, not a github.com/…/blob/ page) from a public source, or a data:image URL.`
      : icon.kind === 'github'
        ? 'GitHub (auto-detected)'
        : icon.kind === 'gitlab'
          ? 'GitLab (auto-detected)'
          : icon.kind === 'none'
            ? undefined
            : 'Custom icon',
  );
</script>

<span
  class="tile {size} {icon.kind}"
  class:broken
  {title}
  style:--tile={icon.kind === 'symbol' ? icon.color : undefined}
>
  {#if icon.kind === 'github' || icon.kind === 'gitlab'}<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"
      ><path d={LOGOS[icon.kind]} /></svg
    >
  {:else if broken}?
  {:else if icon.kind === 'image' && icon.path}<img src={icon.path} alt="" onerror={() => (failedPath = icon.path)} />
  {:else if icon.kind === 'symbol' && icon.symbol && isIconName(icon.symbol)}<Icon
      name={icon.symbol}
      size={size === 'lg' ? 'lg' : 'sm'}
      weight={1.8}
    />
  {:else}{(icon.symbol ?? name).slice(0, 1).toUpperCase()}
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

  .github {
    background: var(--brand-github);
  }

  .gitlab {
    background: var(--brand-gitlab);
  }

  .none {
    color: var(--fg);
  }

  .broken {
    color: var(--fg);
    cursor: help;
  }

  .logo {
    width: 70%;
    height: 70%;
    fill: currentcolor;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
