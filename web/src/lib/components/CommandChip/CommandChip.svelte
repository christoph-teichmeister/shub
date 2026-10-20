<script lang="ts">
  import type { Session } from '../../../../../shared/api.ts';
  import { api } from '../../stores/api.ts';
  import { toast, toastError } from '../../stores/toasts.svelte.ts';
  import Button from '../Button/Button.svelte';
  import Icon from '../Icon/Icon.svelte';
  import IconButton from '../IconButton/IconButton.svelte';

  interface Props {
    session: Session;
    /** Phone: Run asks for a second tap, then sends Enter too (Enter on the phone keyboard is fiddly). */
    phone?: boolean;
    /** Opens a plain terminal and returns its session id; the chip types the command in, not run (sudo, logins). */
    onterminal: () => Promise<string | null | undefined>;
  }
  let { session, phone = false, onterminal }: Props = $props();

  const commands = $derived(session.pendingCommands ?? []);
  let armed = $state<number | null>(null);

  function answer(index: number, action: 'run' | 'dismiss') {
    const enter = action === 'run' && phone;
    void api('sessionCommand', { params: { id: session.id }, body: { index, action, enter } }).catch(toastError);
  }

  function run(index: number) {
    if (phone && armed !== index) {
      armed = index;
      return;
    }
    answer(index, 'run');
  }

  async function openTerminal(index: number, command: string) {
    const shell = await onterminal();
    if (!shell) return;
    answer(index, 'dismiss');
    // ponytail: fixed wait for the shell's prompt, so the paste lands bracketed instead of running line by line
    setTimeout(
      () => void api('sessionPaste', { params: { id: shell }, body: { text: command } }).catch(toastError),
      600,
    );
  }

  async function copy(command: string) {
    await navigator.clipboard.writeText(command).catch(toastError);
    toast('Copied');
  }
</script>

{#if commands.length}
  <section class="chip" class:phone aria-label="Commands from Claude">
    <header>
      <Icon name="terminal" />
      <span class="title"
        >Claude asks you to run {commands.length === 1 ? '1 command' : `${commands.length} commands`}</span
      >
      <IconButton label="Dismiss" icon="close" tone="muted" onclick={() => answer(0, 'dismiss')} />
    </header>
    {#each commands as command, i (i)}
      <code>{command}</code>
      <div class="actions">
        <Button variant="primary" icon="terminal" block={phone} onclick={() => openTerminal(i, command)}
          >Open in terminal</Button
        >
        <Button onclick={() => run(i)}>{armed === i ? 'Tap again to run' : 'Run in session'}</Button>
        <Button variant="ghost" onclick={() => copy(command)}>Copy</Button>
        {#if !phone}<span class="hint">Run in session suits commands without sudo or a login</span>{/if}
      </div>
    {/each}
  </section>
{/if}

<style>
  .chip {
    display: flex;
    flex-direction: column;
    gap: var(--space-2-5);
    margin: 0 var(--space-4) var(--space-3);
    padding: var(--space-3) var(--space-3-5);
    border: var(--hairline) solid var(--status-needs-you);
    border-radius: var(--radius-lg);
    background: var(--panel);
  }

  .phone {
    margin: 0;
    border-width: var(--hairline) 0 0;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--status-needs-you-fg);
    font-size: var(--text-sm);
  }

  .title {
    flex: 1 1 auto;
    font-weight: 600;
  }

  code {
    display: block;
    padding: var(--space-2) var(--space-2-5);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    white-space: pre-wrap;
    word-break: break-all;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .hint {
    margin-left: auto;
    font-size: var(--text-xs);
    color: var(--muted);
  }
</style>
