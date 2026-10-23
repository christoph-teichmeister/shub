# MachineSwitcher

Chips for the machines this browser or phone knows (`fleet` in `stores/machines.svelte.ts`), plus "+" to pair another one. The
shown machine is highlighted; the others show online, offline or "waiting for approval", and how many sessions need
you there. A tap on another machine reloads the app against it. Phones show them from the first machine on, a desktop browser
only with more than one. The component is always mounted, for its dialog, which Settings > Devices opens via
`fleet.adding`.

No props. "+" opens a dialog: scan the other machine's pairing QR (browsers with `BarcodeDetector`, i.e. Chrome on
Android) or type its address and the 8-character code, then wait until the phone is approved there.
