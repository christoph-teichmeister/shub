<script lang="ts">
  import type { ChatMessage, Session } from '../../../../../shared/api.ts';
  import { api } from '../../stores/api.ts';
  import { app, sendKeys } from '../../stores/state.svelte.ts';
  import { toastError } from '../../stores/toasts.svelte.ts';
  import Icon from '../Icon/Icon.svelte';
  import Preview from '../NotesPanel/Preview.svelte';
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';

  interface Props {
    session: Session;
    /** Shown between the messages and the input: permission question, command chips. */
    children?: Snippet;
  }
  let { session, children }: Props = $props();

  let messages = $state<ChatMessage[]>([]);
  let loaded = $state(false);
  let list = $state<HTMLElement>();
  let stuck = true;

  // Refetch the tail on every nudge (session.messages) and when /clear gives the session a new transcript.
  // ponytail: the whole tail each time, no diffing; add ?after= once the 80 messages get heavy.
  $effect(() => {
    void app.messagesVersion[session.id];
    void session.claudeSessionId;
    let stale = false;
    api<ChatMessage[]>('sessionMessages', { params: { id: session.id } }).then(
      (next) => {
        if (stale) return;
        messages = next;
        loaded = true;
        if (stuck) void tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
      },
      () => (loaded = true),
    );
    return () => (stale = true);
  });

  // Stay at the bottom while it is where the reader is; scrolling up to read stops the follow.
  const onscroll = () => (stuck = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 80);

  // The caller keys this component by session id, so the id never changes under it.
  // svelte-ignore state_referenced_locally
  const DRAFT = `shub.chatDraft.${session.id}`;
  let text = $state('');
  try {
    text = localStorage.getItem(DRAFT) ?? '';
  } catch {
    // storage blocked: no draft kept
  }
  $effect(() => {
    try {
      if (text) localStorage.setItem(DRAFT, text);
      else localStorage.removeItem(DRAFT);
    } catch {
      // not kept
    }
  });

  // Only Control types text (paste); a Prompts phone answers questions with the buttons.
  const canType = $derived(!app.me?.caller?.level || app.me.caller.level === 'control');
  let sending = $state(false);
  async function send(e: SubmitEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    sending = true;
    try {
      // Pasted (bracketed), so newlines stay in the message; then Enter submits it.
      await api('sessionPaste', { params: { id: session.id }, body: { text: body } });
      await sendKeys(session.id, ['Enter']);
      text = '';
      stuck = true;
    } catch (err) {
      toastError(err);
    } finally {
      sending = false;
    }
  }

  const STATUS = { running: 'running', ok: 'done', error: 'failed' } as const;
</script>

<div class="chat">
  <div class="list" bind:this={list} {onscroll} role="log" aria-label="Conversation">
    {#each messages as m (m.id)}
      {#if m.role === 'user'}
        <p class="user">{m.text}</p>
      {:else if m.role === 'assistant'}
        <div class="assistant"><Preview md={m.text} bare /></div>
      {:else}
        <div class="tool" class:failed={m.status === 'error'}>
          <span class="name">{m.name}</span>
          <span class="summary">{m.summary}</span>
          <span class="state">{STATUS[m.status]}</span>
        </div>
      {/if}
    {:else}
      {#if loaded}<p class="empty">No messages yet. Write one below.</p>{/if}
    {/each}
  </div>

  {@render children?.()}

  {#if canType}
    <form class="input" onsubmit={send}>
      <label class="visually-hidden" for="chat-msg">Message to Claude</label>
      <textarea id="chat-msg" bind:value={text} rows="1" placeholder="Message to Claude…" enterkeyhint="enter"
      ></textarea>
      <button type="submit" class="send" aria-label="Send" disabled={sending || !text.trim()}
        ><Icon name="send" /></button
      >
    </form>
  {/if}
</div>

<style>
  .chat {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    color: var(--fg);
    overflow-wrap: anywhere;
  }

  .user {
    align-self: flex-end;
    max-width: 85%;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-xl) var(--radius-xl) var(--radius-xs) var(--radius-xl);
    background: var(--raised);
    font-size: var(--text-base);
    white-space: pre-wrap;
  }

  .assistant {
    line-height: 1.5;
  }

  .tool {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-2-5);
    border: var(--hairline) solid var(--line);
    border-radius: var(--radius-md);
    background: var(--panel);
    font-size: var(--text-sm);
  }

  .name {
    flex: none;
    font-weight: var(--weight-semibold);
  }

  .summary {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--fg-2);
    font-family: var(--font-mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .state {
    flex: none;
    color: var(--muted);
  }

  .failed .state {
    color: var(--danger);
  }

  .empty {
    margin: auto;
    color: var(--muted);
  }

  .input {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) calc(var(--space-3) + env(safe-area-inset-bottom));
    background: var(--panel);
  }

  textarea {
    flex: 1 1 auto;
    min-width: 0;
    min-height: var(--size-touch);
    max-height: 40dvh;
    padding: var(--space-2-5) var(--space-3);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    resize: none;
    field-sizing: content;
  }

  .send {
    flex: none;
    width: var(--size-touch);
    height: var(--size-touch);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--primary);
    color: var(--primary-fg);
    cursor: pointer;
  }

  .send:disabled {
    opacity: 0.5;
  }
</style>
