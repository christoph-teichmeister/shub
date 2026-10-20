# MachineSwitcher

Chips for the machines a phone app knows (`fleet` in `stores/machines.svelte.ts`), plus "+" to pair another one. The
shown machine is highlighted; the others show online, offline or "waiting for approval", and how many sessions need
you there. A tap on another machine reloads the app against it. Only rendered when the app has device keys (a phone);
desktop browsers sign in with a cookie and see no switcher.

No props. "+" opens a dialog: scan the other machine's pairing QR (browsers with `BarcodeDetector`, i.e. Chrome on
Android) or type its address and the 8-character code, then wait until the phone is approved there.
