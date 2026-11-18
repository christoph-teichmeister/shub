<script lang="ts">
  import Button from '../components/Button/Button.svelte';
  import { gameBack } from '../stores/router.svelte.ts';

  // The one place the game's address lives. The server's CSP lists the same host under frame-src (server/api/index.ts).
  const GAME_URL = 'https://aidle-digital.web.app/';

  // Mounted once by App.svelte and only hidden when you leave, so the iframe is never rebuilt and the game keeps
  // exactly where it was. Nothing here reloads it except the button.
  let { active }: { active: boolean } = $props();
  let frame: HTMLIFrameElement;

  function onKeydown(e: KeyboardEvent) {
    if (active && e.altKey && e.code === 'KeyV') {
      e.preventDefault();
      location.hash = gameBack();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="game" class:off={!active}>
  <header>
    <a class="back" href={gameBack()} title="Back to shub (Alt V)">← shub</a>
    <h1>Game</h1>
    <span class="grow"></span>
    <Button size="sm" onclick={() => (frame.src = GAME_URL)}>Restart game</Button>
  </header>
  <iframe bind:this={frame} title="Game" src={GAME_URL} allow="fullscreen"></iframe>
</div>

<style>
  .game {
    height: 100vh;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--bg);
    color: var(--fg);
  }

  .game.off {
    display: none;
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  h1 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  .back {
    color: var(--muted);
    text-decoration: none;
  }

  .grow {
    flex: 1 1 auto;
  }

  iframe {
    flex: 1 1 auto;
    min-height: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--panel);
  }
</style>
