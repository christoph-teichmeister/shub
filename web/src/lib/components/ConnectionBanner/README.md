# ConnectionBanner

Strip at the top of the page when the shown machine cannot be reached: "does not answer", "Connection lost, reconnecting", or an API version mismatch. Says when the data on screen was last fresh ("Showing data from 14:05") and offers "Retry now" (reloads everything and reconnects the events socket). It has an icon and words, not colour alone; only "does not answer" is `role="alert"`, the others are polite status. Renders nothing while all is well. Mounted in `AppShell` (desktop) and in `Phone` (overview and session pages).

| Prop         | Type                                        | Default                |
| ------------ | ------------------------------------------- | ---------------------- |
| `kind`       | `'offline' \| 'reconnecting' \| 'mismatch'` | derived from the store |
| `machine`    | `string`                                    | the shown machine      |
| `apiVersion` | `number`                                    | the store's            |
| `since`      | `number \| null` (ms)                       | last answered call     |
| `onretry`    | `() => void`                                | `retryNow()`           |

Pass `kind` (or `null` for none) only to render a fixed state (styleguide). Mismatch has no retry: the fix is updating the older machine.
