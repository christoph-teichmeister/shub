<script lang="ts">
  interface Props {
    text: string;
    tone?: 'needs-you' | 'working' | 'done' | 'neutral';
  }
  let { text, tone = 'neutral' }: Props = $props();
</script>

<span class="badge {tone}">{text}</span>

<style>
  .badge {
    flex: none;
    font-size: var(--text-xs);
    line-height: var(--leading-base);
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    border: var(--hairline) solid transparent;
    white-space: nowrap;
    text-transform: none;
    letter-spacing: normal;
  }

  .needs-you {
    background: var(--status-needs-you);
    color: var(--on-accent);
    font-weight: var(--weight-semibold);
  }

  .working {
    border-color: var(--status-working);
    color: var(--status-working);
  }

  .done {
    border-color: var(--status-your-turn);
    color: var(--status-your-turn);
  }

  .neutral {
    background: var(--raised);
    color: var(--fg-2);
  }
</style>
