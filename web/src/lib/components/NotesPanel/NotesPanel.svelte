<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError, api } from '../../stores/api.ts';
  import { toast, toastError } from '../../stores/toasts.svelte.ts';
  import Button from '../Button/Button.svelte';
  import IconButton from '../IconButton/IconButton.svelte';
  import Preview from './Preview.svelte';

  interface Props {
    /** The session (or one of its panes) whose draft this is. */
    sessionId: string;
    /** Claude session that gets "Tell Claude"; omitted when the session is a plain terminal. */
    claudeId?: string;
    onhide: () => void;
    /** A knowledge base note to show instead of the draft. */
    note?: { file: string; url: string | null } | null;
    /** Back to the draft. */
    onback?: () => void;
  }
  let { sessionId, claudeId, onhide, note = null, onback }: Props = $props();

  const POLL_MS = 2000;
  const SAVE_MS = 700;

  let text = $state('');
  let path = $state('');
  /** Revision of the file `text` was based on. */
  let rev = '';
  let dirty = $state(false);
  /** The file changed under unsaved typing: what it holds now. */
  let theirs = $state<{ text: string; rev: string } | null>(null);
  let preview = $state(false);
  let saving = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function fetchNotes() {
    if (note) {
      const n = await api<{ text: string; rev: string }>('noteFile', { query: { path: note.file } });
      return { path: note.file, ...n };
    }
    return api<{ path: string; text: string; rev: string }>('notes', { params: { id: sessionId } });
  }

  async function poll() {
    if (saving || theirs) return;
    const base = rev;
    const n = await fetchNotes();
    // A save finished (or started) meanwhile: this answer is older than what we hold.
    if (saving || theirs || rev !== base) return;
    path = n.path;
    if (n.rev === rev) return;
    if (dirty) theirs = { text: n.text, rev: n.rev };
    else {
      text = n.text;
      rev = n.rev;
    }
  }

  async function save() {
    clearTimeout(timer);
    if (!dirty || saving || theirs) return;
    saving = true;
    const sent = text;
    try {
      const body = { text: sent, rev };
      const saved = note
        ? await api<{ rev: string }>('noteFileSave', { query: { path: note.file }, body })
        : await api<{ rev: string }>('notesSave', { params: { id: sessionId }, body });
      rev = saved.rev;
      if (text === sent) dirty = false;
      else timer = setTimeout(save, SAVE_MS);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) theirs = await fetchNotes();
      else toastError(e);
    } finally {
      saving = false;
    }
  }

  function typed() {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_MS);
  }

  function takeTheirs() {
    if (!theirs) return;
    ({ text, rev } = theirs);
    theirs = null;
    dirty = false;
  }

  function keepMine() {
    if (!theirs) return;
    rev = theirs.rev;
    theirs = null;
    void save();
  }

  function tellClaude() {
    if (!claudeId) return;
    const prompt =
      `We write a Markdown draft together in shub's notes panel. It is the file ${path}. ` +
      `Read it before you answer. When I ask for a change, edit that file directly; I see it live and may type in it too, ` +
      `so read it again before each edit.`;
    api('sessionPaste', { params: { id: claudeId }, body: { text: prompt } })
      .then(() => toast("Pasted into Claude's prompt, press Enter to send"))
      .catch(toastError);
  }

  onMount(() => {
    void fetchNotes()
      .then((n) => ({ path, text, rev } = n))
      .catch(toastError);
    const poller = setInterval(() => void poll().catch(() => {}), POLL_MS);
    return () => {
      clearInterval(poller);
      void save();
    };
  });
</script>

<section class="notes" aria-label="Notes">
  <div class="bar">
    {#if note}
      <IconButton label="Back to the draft" icon="chevron-left" size="xs" tone="muted" onclick={onback} />
      <h2 title={path}>{path.split('/').pop()}</h2>
    {:else}<h2>Notes</h2>{/if}
    <span class="state">{theirs ? 'changed outside' : dirty ? 'saving…' : 'saved'}</span>
    <span class="modes">
      <Button size="sm" variant="ghost" pressed={!preview} onclick={() => (preview = false)}>Write</Button>
      <Button size="sm" variant="ghost" pressed={preview} onclick={() => (preview = true)}>Preview</Button>
    </span>
    <span class="spacer"></span>
    {#if note?.url}<Button size="sm" variant="ghost" onclick={() => open(note.url!, '_blank')}>KB app</Button>{/if}
    {#if claudeId && !note}<Button
        size="sm"
        variant="ghost"
        icon="sparkle"
        onclick={tellClaude}
        title="Paste the file path and how to work on it into Claude's prompt">Tell Claude</Button
      >{/if}
    <IconButton label="Hide notes (Alt M)" icon="close" size="xs" tone="muted" onclick={onhide} />
  </div>
  {#if theirs}
    <div class="conflict" role="alert">
      <span>Claude (or another editor) changed the file while you typed.</span>
      <Button size="sm" onclick={takeTheirs}>Take theirs</Button>
      <Button size="sm" variant="ghost" onclick={keepMine}>Keep mine</Button>
    </div>
  {/if}
  {#if preview}
    <Preview md={text} />
  {:else}
    <textarea
      bind:value={text}
      oninput={typed}
      spellcheck="true"
      aria-label="Markdown draft"
      placeholder="Write Markdown here. Claude edits the same file."></textarea>
  {/if}
  {#if path}<div class="path" title={path}>{path}</div>{/if}
</section>

<style>
  .notes {
    flex: 0 0 min(45%, 560px);
    min-width: 280px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: var(--hairline) solid var(--line);
    background: var(--panel);
    font-size: var(--text-md);
  }

  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    height: var(--size-control);
    padding: 0 var(--space-2-5);
    border-bottom: var(--hairline) solid var(--line);
  }

  h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
  }

  .state,
  .path {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .modes {
    display: flex;
    gap: var(--space-0-5);
  }

  .spacer {
    flex: 1 1 auto;
  }

  .conflict {
    flex: none;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2-5);
    border-bottom: var(--hairline) solid var(--line);
    color: var(--fg);
  }

  textarea {
    flex: 1 1 auto;
    min-height: 0;
    resize: none;
    padding: var(--space-3);
    border: 0;
    outline: none;
    background: transparent;
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: var(--text-md);
    line-height: 1.6;
    tab-size: 2;
  }

  .path {
    flex: none;
    padding: var(--space-1) var(--space-2-5);
    border-top: var(--hairline) solid var(--line);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
