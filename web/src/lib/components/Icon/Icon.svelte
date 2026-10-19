<script lang="ts">
  import { ICONS, type IconName } from './icons.ts';

  interface Props {
    name: IconName;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    /** Stroke width on the 16 px grid. */
    weight?: number;
    /** Accessible name; without it the icon is decorative (aria-hidden). */
    label?: string;
  }
  let { name, size = 'lg', weight = 1.6, label }: Props = $props();
  const icon = $derived(ICONS[name] as { d: string; fill?: boolean });
</script>

<svg
  class="icon {size}"
  viewBox="0 0 16 16"
  fill={icon.fill ? 'currentColor' : 'none'}
  stroke={icon.fill ? 'none' : 'currentColor'}
  stroke-width={name === 'more' ? 2.6 : weight}
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  <path d={icon.d} />
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }

  .xs {
    width: var(--size-check);
    height: var(--size-check);
  }

  .sm {
    width: var(--size-icon-sm);
    height: var(--size-icon-sm);
  }

  .md {
    width: var(--size-icon);
    height: var(--size-icon);
  }

  .lg {
    width: var(--size-icon-md);
    height: var(--size-icon-md);
  }
</style>
