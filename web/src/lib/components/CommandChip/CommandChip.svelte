<script lang="ts">
  import type { HandedCommand, Session } from '../../../../../shared/api.ts';
  import { commandTarget, type CommandTarget } from '../../../../../shared/commands.ts';
  import { api } from '../../stores/api.ts';
  import { app } from '../../stores/state.svelte.ts';
  import { toast, toastError } from '../../stores/toasts.svelte.ts';
  import Button from '../Button/Button.svelte';
  import Icon from '../Icon/Icon.svelte';
  import IconButton from '../IconButton/IconButton.svelte';

  interface Props {
    session: Session;
    /** Phone: Run asks for a second tap, so a stray tap on the small screen runs nothing. */
    phone?: boolean;
    /** Opens a plain terminal (in `cwd` when the command names a folder) and returns its session id; the chip
     *  types the command in, not run (sudo, logins). */
    onterminal: (cwd?: string) => Promise<string | null | undefined>;
  }
  let { session, phone = false, onterminal }: Props = $props();

  const commands = $derived(
    (session.pendingCommands ?? []).map((c) => ({ ...c, target: commandTarget(c, app.sessions, session.id) })),
  );
  let armed = $state<number | null>(null);

  function answer(index: number, action: 'run' | 'dismiss') {
    void api('sessionCommand', { params: { id: session.id }, body: { index, action } }).catch(toastError);
  }

  function run(index: number) {
    if (phone && armed !== index) {
      armed = index;
      return;
    }
    answer(index, 'run');
  }

  /** The folder a shell for this command opens in; none = next to this session. */
  const folderOf = (t: CommandTarget) =>
    t.kind === 'session' ? t.session.cwd : t.kind === 'folder' ? t.cwd : undefined;

  function runLabel(t: CommandTarget, i: number) {
    if (armed === i) return 'Tap again to run';
    if (t.kind !== 'session') return 'Run in session';
    return t.running ? `Run in ${t.session.name}` : `Resume ${t.session.name} and run`;
  }

  async function openTerminal(index: number, { command, target }: HandedCommand & { target: CommandTarget }) {
    const shell = await onterminal(folderOf(target));
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
    {#each commands as handed, i (i)}
      {@const t = handed.target}
      {#if t.kind === 'session'}
        <p class="target">Runs in {t.session.name}{t.running ? '' : ` (${t.session.status})`}</p>
      {:else if t.kind === 'folder'}
        <p class="target">No session in {t.cwd}: opens a terminal there</p>
      {:else if t.kind === 'unknown'}
        <p class="target">Meant for session "{t.ref}", which shub does not know</p>
      {/if}
      <code>{handed.command}</code>
      <div class="actions">
        <Button variant="primary" icon="terminal" block={phone} onclick={() => openTerminal(i, handed)}
          >Open in terminal</Button
        >
        {#if t.kind === 'self' || t.kind === 'session'}
          <Button onclick={() => run(i)}>{runLabel(t, i)}</Button>
        {/if}
        <Button variant="ghost" onclick={() => copy(handed.command)}>Copy</Button>
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

  .target {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .hint {
    margin-left: auto;
    font-size: var(--text-xs);
    color: var(--muted);
  }
</style>
