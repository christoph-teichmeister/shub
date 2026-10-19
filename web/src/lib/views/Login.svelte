<script lang="ts">
  import Button from '../components/Button/Button.svelte';
  import Checkbox from '../components/Checkbox/Checkbox.svelte';
  import TextField from '../components/TextField/TextField.svelte';
  import Wordmark from '../components/Wordmark/Wordmark.svelte';
  import { api, ApiError } from '../stores/api.ts';
  import { pushSupported, subscribePush } from '../stores/push.ts';

  /** Set on /pair/<code>: the phone signs in with the pairing code instead of the token. */
  let { pairCode }: { pairCode?: string } = $props();

  let token = $state('');
  let remember = $state(true);
  let deviceName = $state(
    /android/i.test(navigator.userAgent) ? 'Android phone' : /iphone/i.test(navigator.userAgent) ? 'iPhone' : 'Phone',
  );
  let error = $state('');
  let busy = $state(false);
  let paired = $state(false);

  const message = (err: unknown) =>
    err instanceof ApiError && err.status === 401
      ? pairCode
        ? 'This code is used or ran out. Make a new one in Settings on the desktop.'
        : 'Wrong token'
      : err instanceof Error
        ? err.message
        : String(err);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      if (pairCode) {
        await api('pairingRedeem', { body: { code: pairCode, deviceName: deviceName.trim() } });
        paired = true;
      } else {
        // ponytail: the server always sets a 30-day cookie; `remember` is sent for when it learns session cookies.
        await api('login', { body: { token: token.trim(), remember } });
        location.replace('/#/');
        location.reload();
      }
    } catch (err) {
      error = message(err);
    } finally {
      busy = false;
    }
  }

  async function push() {
    try {
      await subscribePush();
      done();
    } catch (err) {
      error = message(err);
    }
  }

  const done = () => location.replace('/');
</script>

<div class="page">
  <form class="card" onsubmit={submit}>
    <div class="brand">
      <h1 class="visually-hidden">shub</h1>
      <Wordmark size="lg" tagline />
      <span class="host">{location.host}</span>
    </div>

    {#if paired}
      <p class="ok" role="status">This phone is signed in as {deviceName}.</p>
      {#if pushSupported()}
        <p class="note">Get a push when a session needs you. Add shub to the home screen first on iOS.</p>
        <Button block variant="primary" onclick={push}>Turn on push</Button>
      {/if}
      <Button block variant={pushSupported() ? 'ghost' : 'primary'} onclick={done}>Open shub</Button>
    {:else if pairCode}
      <TextField label="Device name" bind:value={deviceName} required hint="Shown in the device list on the desktop." />
      <Button block variant="primary" type="submit" disabled={busy}>Pair this phone</Button>
    {:else}
      <TextField
        label="Access token"
        type="password"
        bind:value={token}
        required
        autocomplete="current-password"
        mono
        hint="It is in ~/.local/state/shub/token on the desktop. A paired phone signs in by QR code instead."
      />
      <Checkbox label="Remember this device for 30 days" bind:checked={remember} />
      <Button block variant="primary" type="submit" disabled={busy}>Sign in</Button>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </form>
</div>

<style>
  .page {
    min-height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-8) var(--space-4);
    background: var(--bg);
  }

  .card {
    width: 100%;
    max-width: var(--size-login);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-xl);
    background: var(--panel);
  }

  .brand {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .host,
  .note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .ok {
    margin: 0;
    color: var(--fg);
  }

  .error {
    margin: 0;
    color: var(--danger);
  }
</style>
