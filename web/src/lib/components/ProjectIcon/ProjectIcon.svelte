<script lang="ts">
  import type { ResolvedIcon } from '../../../../../shared/api.ts';
  import Icon from '../Icon/Icon.svelte';
  import { isIconName } from '../Icon/icons.ts';

  interface Props {
    icon: ResolvedIcon;
    /** Project name, for the fallback letter and the tooltip. */
    name: string;
    size?: 'sm' | 'md' | 'lg';
  }
  let { icon, name, size = 'md' }: Props = $props();

  const title = $derived(
    icon.kind === 'github'
      ? 'GitHub (auto-detected)'
      : icon.kind === 'gitlab'
        ? 'GitLab (auto-detected)'
        : icon.kind === 'none'
          ? undefined
          : 'Custom icon',
  );
</script>

<span class="tile {size} {icon.kind}" {title} style:--tile={icon.kind === 'symbol' ? icon.color : undefined}>
  {#if icon.kind === 'github'}GH
  {:else if icon.kind === 'gitlab'}GL
  {:else if icon.kind === 'image' && icon.path}<img src={icon.path} alt="" />
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

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
