<script lang="ts">
  // A session's right-click menu (sidebar row or tab), with its "Add link" and "Wait for…" dialogs.
  import type { ButtonDef, ProjectView, Session, SessionLink } from '../../../../../shared/api.ts';
  import Button from '../../components/Button/Button.svelte';
  import Dialog from '../../components/Dialog/Dialog.svelte';
  import Menu, { type MenuItem } from '../../components/Menu/Menu.svelte';
  import { canCompact, contextFill } from '../../status.ts';
  import { api } from '../../stores/api.ts';
  import { app, compact, pinSession, unpinSession } from '../../stores/state.svelte.ts';
  import { toast, toastError } from '../../stores/toasts.svelte.ts';

  interface Props {
    menu: { session: Session; x: number; y: number } | null;
    /** The open project: its buttons show for its own sessions. */
    project: ProjectView | null;
    onrename: (s: Session) => void;
    onclose: (s: Session) => void;
    onclaudehere: (s: Session) => void;
    onrunbutton: (b: ButtonDef) => void;
  }
  let { menu = $bindable(), project, onrename, onclose, onclaudehere, onrunbutton }: Props = $props();

  let linkDraft = $state<{ session: Session; label: string; url: string } | null>(null);
  const WAIT_ON_DONE =
    'A background check says the wait is over: {summary}. Verify that yourself first, then carry on.';
  let waitDraft = $state<{
    session: Session;
    reason: string;
    check: string;
    every: number;
    then: 'notify' | 'send';
    onDone: string;
  } | null>(null);

  function menuItems(s: Session): MenuItem[] {
    const fill = contextFill(s);
    const plugin = app.plugins.flatMap((p) =>
      p.enabled ? p.sessionMenuActions.map((a) => ({ id: `plugin:${p.name}:${a.id}`, label: a.label })) : [],
    );
    // Buttons start sessions in the open project, so a sidebar row of another project leaves them out.
    const buttons = (s.projectId === project?.id ? project.buttons : [])
      .filter((b) => b.confirm)
      .map((b, i) => ({
        id: `button:${b.id}`,
        label: `${b.label}${b.ask !== 'nothing' ? '…' : ''}`,
        separator: i === 0,
      }));
    // Groups, divided by separators: organise the row, steer the session, plugin actions, buttons, close.
    return [
      { id: 'rename', label: 'Rename' },
      { id: 'link', label: 'Add link…', hint: s.links[0]?.label },
      { id: 'copy-id', label: 'Copy session ID', hint: s.id.slice(0, 8) },
      ...(!s.projectId
        ? []
        : [s.position == null ? { id: 'pin', label: 'Pin to top' } : { id: 'unpin', label: 'Unpin' }]),
      ...(s.kind === 'shell'
        ? s.parentId
          ? []
          : [{ id: 'claude-here', label: 'Start Claude here', separator: true }]
        : [
            s.waitingFor
              ? { id: 'ready', label: 'Stop waiting', description: s.waitingFor, separator: true }
              : { id: 'wait', label: 'Wait for…', separator: true },
          ]),
      ...(fill?.compact
        ? [
            {
              id: 'compact',
              label: 'Compact',
              hint: `${fill.pct} %`,
              disabled: !canCompact(s),
              description: canCompact(s) ? undefined : 'Once it is your turn',
            },
          ]
        : []),
      { id: 'pause', label: s.status === 'paused' ? 'Resume session' : 'Pause session' },
      ...plugin.map((a, i) => ({ ...a, separator: i === 0 })),
      ...buttons,
      { id: 'close', label: 'Close session', separator: true, danger: true },
    ];
  }

  function onMenu(s: Session, id: string) {
    if (id === 'rename') onrename(s);
    else if (id === 'copy-id')
      void navigator.clipboard.writeText(s.id).then(() => toast('Session ID copied'), toastError);
    else if (id === 'link') linkDraft = { session: s, label: '', url: '' };
    else if (id === 'wait')
      waitDraft = { session: s, reason: '', check: '', every: 30, then: 'notify', onDone: WAIT_ON_DONE };
    else if (id === 'ready')
      void api('sessionUpdate', { params: { id: s.id }, body: { waitingFor: null } }).catch(toastError);
    else if (id === 'pause')
      void api(s.status === 'paused' ? 'sessionResume' : 'sessionPause', { params: { id: s.id } }).catch(toastError);
    else if (id === 'close') onclose(s);
    else if (id === 'compact') compact(s);
    else if (id === 'claude-here') onclaudehere(s);
    else if (id === 'pin') pinSession(s);
    else if (id === 'unpin') unpinSession(s);
    else if (id.startsWith('button:')) {
      const b = project?.buttons.find((x) => x.id === id.slice(7));
      if (b) onrunbutton(b);
    } else if (id.startsWith('plugin:')) {
      const [, name, actionId] = id.split(':');
      void api('pluginAction', {
        params: { name, actionId },
        body: { sessionId: s.id, projectId: s.projectId ?? undefined },
      }).catch(toastError);
    }
  }

  function saveLink() {
    if (!linkDraft) return;
    const link: SessionLink = { source: 'user', label: linkDraft.label.trim(), url: linkDraft.url.trim() };
    void api('sessionLink', { params: { id: linkDraft.session.id }, body: link }).catch(toastError);
    linkDraft = null;
  }

  function saveWait() {
    if (!waitDraft) return;
    const { session, reason, check, every, then, onDone } = waitDraft;
    const body = {
      waitingFor: reason.trim(),
      waitCheck: check.trim() || undefined,
      waitEveryMinutes: every,
      waitOnDone: then === 'send' ? onDone.trim() || WAIT_ON_DONE : null,
    };
    void api('sessionUpdate', { params: { id: session.id }, body }).catch(toastError);
    waitDraft = null;
  }
</script>

{#if menu}
  {@const s = menu.session}
  <Menu
    label="Session menu"
    items={menuItems(s)}
    x={menu.x}
    y={menu.y}
    onselect={(id) => onMenu(s, id)}
    onclose={() => (menu = null)}
  />
{/if}

<Dialog open={!!linkDraft} title="Add link" onclose={() => (linkDraft = null)}>
  {#if linkDraft}
    <form
      id="link-form"
      class="form"
      onsubmit={(e) => {
        e.preventDefault();
        saveLink();
      }}
    >
      <label class="field"><span>Label</span><input bind:value={linkDraft.label} required /></label>
      <label class="field"><span>URL</span><input type="url" bind:value={linkDraft.url} required /></label>
    </form>
  {/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (linkDraft = null)}>Cancel</Button>
    <Button variant="primary" type="submit" form="link-form">Add</Button>
  {/snippet}
</Dialog>

<Dialog
  open={!!waitDraft}
  title="Wait for…"
  description="Parks the session as waiting, so it stops asking for your turn."
  onclose={() => (waitDraft = null)}
>
  {#if waitDraft}
    <form
      id="wait-form"
      class="form"
      onsubmit={(e) => {
        e.preventDefault();
        saveWait();
      }}
    >
      <label class="field"
        ><span>Waiting for</span><input
          bind:value={waitDraft.reason}
          placeholder="Kai's answer on MR !2213"
          required
        /></label
      >
      <label class="field"
        ><span>How can Haiku tell it happened?</span><textarea
          bind:value={waitDraft.check}
          rows="3"
          placeholder="Look at merge request !2213 in ai/ai-portal on GitLab. Done once Kai has written a new comment or approved it after today 11:00."
        ></textarea></label
      >
      <p class="wait-hint">
        Where to look, whose action, what counts as done. Haiku checks read-only, right away and then at the interval.
        Empty = only park.
      </p>
      {#if waitDraft.check.trim()}
        <div class="wait-row">
          <label class="field"
            ><span>Check every</span><select bind:value={waitDraft.every}>
              {#each [15, 30, 60, 120] as m (m)}<option value={m}>{m < 60 ? `${m} minutes` : `${m / 60} h`}</option
                >{/each}
            </select></label
          >
          <label class="field"
            ><span>When it happened</span><select bind:value={waitDraft.then}>
              <option value="notify">Notify me</option>
              <option value="send">Send a prompt</option>
            </select></label
          >
        </div>
        {#if waitDraft.then === 'send'}
          <label class="field"><span>Prompt</span><textarea bind:value={waitDraft.onDone} rows="2"></textarea></label>
          <p class="wait-hint">
            Claude carries on by itself. <code>{'{summary}'}</code> = Haiku's answer. Haiku can be wrong: use this for clear
            yes/no waits.
          </p>
        {/if}
      {/if}
    </form>
  {/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (waitDraft = null)}>Cancel</Button>
    <Button variant="primary" type="submit" form="wait-form"
      >{waitDraft?.check.trim() ? 'Wait and check' : 'Wait'}</Button
    >
  {/snippet}
</Dialog>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--fg-2);
  }

  .field textarea {
    padding: var(--space-2) var(--space-2-5);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-base);
    resize: vertical;
  }

  .wait-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: var(--space-3);
  }

  .wait-hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .field select,
  .field input {
    height: var(--size-control-md);
    padding: 0 var(--space-2-5);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--fg);
    font-size: var(--text-base);
  }

  code {
    font-family: var(--font-mono);
    font-size: var(--text-md);
  }
</style>
