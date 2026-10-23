<script lang="ts">
  import Button from '../components/Button/Button.svelte';
  import TextField from '../components/TextField/TextField.svelte';
  import Wordmark from '../components/Wordmark/Wordmark.svelte';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../stores/api.ts';
  import { deviceId, deviceToken, here, newKeys, PendingError, rememberDevice } from '../stores/device.ts';
  import { pushSupported, subscribePush } from '../stores/push.ts';
  import type { Device } from '../../../../shared/api.ts';

  /** Set on /pair/<code>: the device signs in with the pairing code instead of the token. */
  let { pairCode }: { pairCode?: string } = $props();

  let token = $state('');
  let typedCode = $state('');
  const phone = matchMedia('(max-width: 699px)').matches;
  let deviceName = $state(
    /android/i.test(navigator.userAgent)
      ? 'Android phone'
      : /iphone/i.test(navigator.userAgent)
        ? 'iPhone'
        : phone
          ? 'Phone'
          : 'Browser',
  );
  /** Opened on the machine itself: the access token (a file only you can read there) makes this the first browser. */
  const onHost = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  let error = $state('');
  let busy = $state(false);
  let paired = $state(false);
  /** Paired, but nobody approved this phone on the machine yet. */
  let waiting = $state(false);

  /** Tries to sign in every 3 s until the machine approves this phone. */
  async function waitForApproval() {
    waiting = true;
    try {
      await deviceToken(here, true);
      waiting = false;
      paired = true;
    } catch (err) {
      if (err instanceof PendingError) setTimeout(() => void waitForApproval(), 3000);
      else ((waiting = false), (error = message(err)));
    }
  }

  // A phone that paired earlier but was not approved yet comes back here after a reload.
  onMount(() => {
    void deviceId().then((id) => {
      if (id) void waitForApproval();
    });
  });

  const message = (err: unknown) =>
    err instanceof ApiError && err.status === 401
      ? pairCode
        ? 'This code is used or ran out. Make a new one in Settings > Devices on a trusted device.'
        : 'Wrong token'
      : err instanceof Error
        ? err.message
        : String(err);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      // The private key never leaves this device; the machine only gets the public half.
      const { keys, publicKey } = await newKeys();
      const code = pairCode ?? typedCode.trim();
      const body = { deviceName: deviceName.trim(), publicKey };
      const { device } = code
        ? await api<{ device: Device }>('pairingRedeem', { body: { ...body, code, kind: phone ? 'phone' : 'browser' } })
        : await api<{ device: Device }>('bootstrap', { body: { ...body, token: token.trim() } });
      const health = await api<{ machine?: string }>('health').catch(() => null);
      await rememberDevice({ origin: here, deviceId: device.id, keys, name: health?.machine ?? location.hostname });
      if (code) void waitForApproval();
      else {
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

    {#if waiting}
      <p class="ok" role="status">
        Paired. Now approve {deviceName} in shub on the machine: Settings > Devices. This page goes on by itself.
      </p>
    {:else if paired}
      <p class="ok" role="status">This device is signed in as {deviceName}.</p>
      {#if pushSupported()}
        <p class="note">Get a push when a session needs you. Add shub to the home screen first on iOS.</p>
        <Button block variant="primary" onclick={push}>Turn on push</Button>
      {/if}
      <Button block variant={pushSupported() ? 'ghost' : 'primary'} onclick={done}>Open shub</Button>
    {:else if pairCode}
      <TextField label="Device name" bind:value={deviceName} required hint="Shown in Settings > Devices." />
      <Button block variant="primary" type="submit" disabled={busy}>Pair this device</Button>
    {:else if onHost}
      <TextField
        label="Access token"
        type="password"
        bind:value={token}
        required
        autocomplete="current-password"
        mono
        hint="It is in ~/.local/state/shub/token. This browser gets its own key and signs in with it from now on."
      />
      <Button block variant="primary" type="submit" disabled={busy}>Sign in</Button>
    {:else}
      <TextField
        label="Pairing code"
        bind:value={typedCode}
        required
        mono
        placeholder="ABCD-EFGH"
        autocapitalize="characters"
        hint="Make one in Settings > Devices in shub on another device, or open its QR link."
      />
      <TextField label="Device name" bind:value={deviceName} required />
      <Button block variant="primary" type="submit" disabled={busy}>Pair this device</Button>
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
