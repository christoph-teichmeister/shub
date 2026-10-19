<script lang="ts">
  interface Props {
    size?: 'sm' | 'md' | 'lg' | 'xl';
    /** Underscore colour: the open project's accent. Defaults to brand pink. */
    accent?: string;
    /** Something needs the user: underscore turns orange and blinks (no blink with reduced motion). */
    needsYou?: boolean;
    tagline?: boolean;
  }
  let { size = 'md', accent, needsYou = false, tagline = false }: Props = $props();
</script>

<span class="wordmark {size}" style:--accent={accent}>
  <span class="text" aria-label={needsYou ? 'shub, a session needs you' : 'shub'}
    ><span aria-hidden="true">shub<span class="underscore" class:needs-you={needsYou}>_</span></span></span
  >
  {#if tagline}<span class="tagline">your session hub</span>{/if}
</span>

<style>
  .wordmark {
    display: inline-flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .text {
    font-family: var(--font-mono);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-wordmark);
    line-height: 1;
    color: var(--fg);
  }

  .sm .text {
    font-size: var(--text-md);
  }

  .md .text {
    font-size: var(--text-lg);
  }

  .lg .text {
    font-size: calc(var(--text-lg) * 1.65);
  }

  .xl .text {
    font-size: var(--text-wordmark-xl);
    font-weight: var(--weight-black);
  }

  .underscore {
    color: var(--accent, var(--pink));
  }

  .underscore.needs-you {
    color: var(--status-needs-you);
  }

  @media (prefers-reduced-motion: no-preference) {
    .underscore.needs-you {
      animation: blink var(--duration-blink) steps(1, end) infinite;
    }
  }

  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  .tagline {
    font-size: var(--text-sm);
    color: var(--fg-2);
  }
</style>
