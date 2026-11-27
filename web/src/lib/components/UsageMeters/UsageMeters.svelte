<script lang="ts">
  // The 5h and 7d limits as two small bars: real usage, plus the muted-green pace (where usage would stand if the
  // limit were used evenly up to its reset). Clicking the 7d meter cycles its pace: until the reset, until Friday 16:00
  // (end of the work week), or both. Renders nothing until a limit is known.
  import { stored, store } from '../../stored.ts';
  import { pace as evenPace, workweekPace } from '../../usagePace.ts';
  import { app } from '../../stores/state.svelte.ts';

  const MODES = ['7d', 'work', 'both'] as const;
  const MODE_LABEL = { '7d': '7d', work: 'Mo–Fr', both: '7d+Fr' };
  let mode = $state<(typeof MODES)[number]>(MODES.find((m) => m === stored('shub.usage7dPace')) ?? '7d');
  const cycle = () => {
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    store('shub.usage7dPace', mode);
  };
</script>

{#if app.usage.fiveHour || app.usage.sevenDay}
  <div class="usage">
    {#each [['5h', app.usage.fiveHour, 5 * 3600], ['7d', app.usage.sevenDay, 7 * 86400]] as const as [label, l, win] (label)}
      {#if l}
        {@const seven = label === '7d'}
        {@const full = l.resetsAt ? evenPace(l.resetsAt, win) : 0}
        {@const work = seven && l.resetsAt ? workweekPace(l.resetsAt) : 0}
        {@const m = seven ? mode : '7d'}
        {@const pace = m === 'work' ? work : full}
        <svelte:element
          this={seven ? 'button' : 'span'}
          class="meter"
          class:clickable={seven}
          role={seven ? 'button' : undefined}
          class:warn={l.resetsAt && l.used >= pace * 0.9}
          class:danger={l.resetsAt && l.used >= pace}
          onclick={seven ? cycle : undefined}
          title={`${label} limit: ${Math.round(l.used)}% used${l.resetsAt ? `, resets ${new Date(l.resetsAt * 1000).toLocaleString()}, even pace to 100% would be ${Math.round(full)}%${seven ? `, until Friday 16:00 ${Math.round(work)}%` : ''}` : ''}${seven ? ' (click to switch pace)' : ''}`}
        >
          <span class="meter-label">{seven ? MODE_LABEL[m] : label}</span>
          <span class="meter-bar"
            >{#if m === 'both'}<span class="pace" style:width={`${work}%`}></span>{/if}<span
              class="pace"
              style:width={`${pace}%`}
            ></span><span class="used" style:width={`${Math.min(100, l.used)}%`}></span></span
          >
          <span class="meter-pct">{Math.round(l.used)}%</span>
          {#if l.resetsAt}<span class="meter-pace"
              >{m === 'both' ? `${Math.round(full)}/${Math.round(work)}` : Math.round(pace)}%</span
            >{/if}
        </svelte:element>
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

  button.meter {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    text-align: left;
  }

  .clickable {
    cursor: pointer;
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

  /* Bar and used % share the tier colour: yellow once used reaches 90 % of the pace, red once it reaches the pace, otherwise green. */
  .meter.warn .meter-bar > .used {
    background: var(--yellow);
  }

  .meter.danger .meter-bar > .used {
    background: var(--pink);
  }

  .meter.warn .meter-pct {
    color: var(--yellow);
  }

  .meter.danger .meter-pct {
    color: var(--pink);
  }
</style>
