<script lang="ts">
  // The 5h and 7d limits as two small bars: real usage, plus the muted-green pace (where usage would stand if the
  // limit were used evenly up to its reset). Renders nothing until a limit is known.
  import { app } from '../../stores/state.svelte.ts';
</script>

{#if app.usage.fiveHour || app.usage.sevenDay}
  <div class="usage">
    {#each [['5h', app.usage.fiveHour, 5 * 3600], ['7d', app.usage.sevenDay, 7 * 86400]] as const as [label, l, win] (label)}
      {#if l}
        {@const pace = l.resetsAt
          ? Math.min(100, Math.max(0, 100 - ((l.resetsAt - Date.now() / 1000) / win) * 100))
          : 0}
        <span
          class="meter"
          class:warn={l.used >= 70}
          class:danger={l.used >= 90}
          title={`${label} limit: ${Math.round(l.used)}% used${l.resetsAt ? `, resets ${new Date(l.resetsAt * 1000).toLocaleString()}, even pace to 100% would be ${Math.round(pace)}%` : ''}`}
        >
          <span class="meter-label">{label}</span>
          <span class="meter-bar"
            ><span class="pace" style:width={`${pace}%`}></span><span
              class="used"
              style:width={`${Math.min(100, l.used)}%`}
            ></span></span
          >
          <span class="meter-pct">{Math.round(l.used)}%</span>
          {#if l.resetsAt}<span class="meter-pace">{Math.round(pace)}%</span>{/if}
        </span>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .usage {
    display: flex;
    gap: var(--space-3);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .meter {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
  }

  .meter-bar {
    flex: 1 1 auto;
    min-width: var(--space-8);
    height: var(--space-1);
    border-radius: var(--radius-pill);
    background: var(--raised);
    overflow: hidden;
    position: relative;
  }

  .meter-bar > span {
    position: absolute;
    inset: 0 auto 0 0;
  }

  .meter-bar > .pace {
    background: color-mix(in srgb, var(--status-your-turn) 30%, transparent);
  }

  .meter-pace {
    color: color-mix(in srgb, var(--status-your-turn) 70%, var(--muted));
  }

  .meter-bar > .used {
    background: var(--status-your-turn);
  }

  .meter.warn .meter-bar > .used {
    background: var(--yellow);
  }

  .meter.danger .meter-bar > .used {
    background: var(--pink);
  }
</style>
