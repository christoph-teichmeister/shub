<script lang="ts">
  // The machines this browser or phone knows, as chips: the shown one highlighted, the others with their state.
  // A desktop browser shows them only with more than one machine. "+" pairs another machine: scan its QR (where the browser can) or type its address and code.
  import { onDestroy } from 'svelte';
  import Button from '../Button/Button.svelte';
  import Dialog from '../Dialog/Dialog.svelte';
  import Icon from '../Icon/Icon.svelte';
  import TextField from '../TextField/TextField.svelte';
  import { addMachine, fleet, parseTarget, switchTo, waitForApproval } from '../../stores/machines.svelte.ts';
  import { app, ui } from '../../stores/state.svelte.ts';

  let address = $state('');
  let code = $state('');
  let deviceName = $state(ui.phone ? (/iphone/i.test(navigator.userAgent) ? 'iPhone' : 'Phone') : 'Browser');
  let busy = $state(false);
  let error = $state('');
  let waitingFor = $state<string | null>(null);
  let video = $state<HTMLVideoElement>();
  let stream = $state<MediaStream | null>(null);
  let abort: AbortController | null = null;

  // Chrome on Android has a barcode reader; Safari on iPhone does not, there the code is typed.
  const canScan = 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

  const label = (origin: string) => {
    const s = fleet.status[origin];
    if (origin === fleet.selected) return app.unreachable ? 'shown, offline' : 'shown';
    if (!s) return '';
    if (s.state === 'pending') return 'waiting for approval';
    if (s.state === 'offline') return 'offline';
    return s.needsYou ? `${s.needsYou} need you` : 'online';
  };

  function stopScan() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  async function scan() {
    error = '';
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (!video) return media.getTracks().forEach((t) => t.stop());
      video.srcObject = media;
      stream = media;
      await video.play();
      const detector = new (window as unknown as { BarcodeDetector: new (o: object) => BarcodeReader }).BarcodeDetector(
        { formats: ['qr_code'] },
      );
      while (stream) {
        const [hit] = await detector.detect(video).catch(() => []);
        if (hit?.rawValue) {
          const target = parseTarget(hit.rawValue);
          address = target.origin;
          code = target.code;
          stopScan();
          return void submit();
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (err) {
      stopScan();
      error = err instanceof Error ? err.message : String(err);
    }
  }

  interface BarcodeReader {
    detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
  }

  async function submit(e?: SubmitEvent) {
    e?.preventDefault();
    busy = true;
    error = '';
    try {
      const origin = await addMachine(address, code, deviceName.trim() || deviceName, ui.phone);
      waitingFor = fleet.list.find((m) => m.origin === origin)?.name ?? origin;
      abort = new AbortController();
      await waitForApproval(origin, abort.signal);
      close();
      switchTo(origin);
    } catch (err) {
      if (!abort?.signal.aborted) error = err instanceof Error ? err.message : String(err);
      waitingFor = null;
    } finally {
      busy = false;
    }
  }

  function close() {
    stopScan();
    abort?.abort();
    fleet.adding = false;
    waitingFor = null;
    address = code = error = '';
  }

  onDestroy(close);
</script>

{#if fleet.list.length > (ui.phone ? 0 : 1)}
  <nav class="machines" aria-label="Machines">
    {#each fleet.list as m (m.origin)}
      {@const s = fleet.status[m.origin]}
      <button
        class="chip"
        class:shown={m.origin === fleet.selected}
        class:needs={!!s?.needsYou}
        class:off={s?.state === 'offline' || s?.state === 'pending' || (m.origin === fleet.selected && app.unreachable)}
        aria-current={m.origin === fleet.selected ? 'true' : undefined}
        onclick={() => m.origin !== fleet.selected && switchTo(m.origin)}
      >
        <span class="dot" aria-hidden="true"></span>
        <span class="name">{m.name.split('.')[0]}</span>
        <span class="visually-hidden">{label(m.origin)}</span>
        {#if s?.needsYou && m.origin !== fleet.selected}<span class="count" aria-hidden="true">{s.needsYou}</span>{/if}
      </button>
    {/each}
    <button class="chip add" aria-label="Add a machine" onclick={() => (fleet.adding = true)}
      ><Icon name="plus" size="sm" /></button
    >
  </nav>
{/if}

<Dialog
  open={fleet.adding}
  title="Add a machine"
  description="On the other machine open shub > Settings > Devices and make a pairing code."
  onclose={close}
>
  {#if waitingFor}
    <p role="status">Now approve this device on {waitingFor}: shub > Settings > Devices. This goes on by itself.</p>
  {:else}
    <form class="form" onsubmit={submit}>
      {#if canScan}
        <!-- One element for the whole scan: swapping it would cut play() off (the stream sits on this one). -->
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={video} class="scan" class:hidden={!stream} playsinline muted></video>
        {#if stream}
          <Button onclick={stopScan}>Stop scanning</Button>
        {:else}
          <Button variant="primary" block onclick={scan}>Scan its QR code</Button>
          <p class="muted small">Or type it:</p>
        {/if}
      {/if}
      <TextField
        label="Address"
        bind:value={address}
        placeholder="pc.tail1234.ts.net"
        hint="Its tailnet name, as shown under Settings > Phone there."
        autocapitalize="off"
        spellcheck={false}
      />
      <TextField label="Pairing code" bind:value={code} placeholder="ABCD-EFGH" autocapitalize="characters" mono />
      <TextField label="This device's name" bind:value={deviceName} />
      <Button variant="primary" block type="submit" disabled={busy || !address || !code}>Pair</Button>
    </form>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</Dialog>

<style>
  .machines {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    padding: 0 var(--space-1) var(--space-3);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: 0 0 auto;
    min-height: var(--size-control-lg);
    padding: 0 var(--space-3);
    border: var(--hairline) solid var(--line-strong);
    border-radius: var(--radius-pill);
    background: var(--panel);
    color: var(--fg);
    font: inherit;
  }

  .chip.shown {
    border-color: var(--ring);
    background: var(--selection);
  }

  .chip.off {
    color: var(--muted);
  }

  .dot {
    width: var(--size-dot);
    height: var(--size-dot);
    border-radius: 50%;
    background: var(--status-your-turn);
  }

  .off .dot {
    background: transparent;
    border: var(--hairline) solid var(--muted);
  }

  .needs .dot {
    background: var(--status-needs-you);
  }

  .count {
    color: var(--status-needs-you);
    font-weight: 600;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .scan {
    width: 100%;
    border-radius: var(--radius-lg);
  }

  .hidden {
    display: none;
  }

  .error {
    color: var(--status-needs-you);
  }
</style>
