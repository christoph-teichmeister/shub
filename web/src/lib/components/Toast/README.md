# Toast

Stack of short messages, bottom right (top, full width, on a phone: the bottom is the message field), announced politely. Call `toast(message, tone, ms, details)` from `stores/toasts.svelte.ts`; mount one `<Toast />` in the app.

| Prop        | Type           | Default            |
| ----------- | -------------- | ------------------ |
| `items`     | `ToastItem[]`  | the toast store    |
| `ondismiss` | `(id) => void` | removes from store |
| `fixed`     | `boolean`      | `true`             |

States: neutral (green check, leaves after 4 s), error (pink, warning icon), needs-you (orange bell; only for "a session needs you"). Errors and needs-you stay until dismissed; hovering pauses the timer line. At most three at once, oldest goes first. Optional `details` (release-notes Markdown, rendered by `Markdown`) show under the message and scroll past 40vh; the update toast uses them for the changelog.
