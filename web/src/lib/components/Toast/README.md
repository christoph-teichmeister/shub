# Toast

Stack of short messages, bottom right, announced politely. Call `toast(message, tone)` from `stores/toasts.svelte.ts`; mount one `<Toast />` in the app.

| Prop        | Type           | Default            |
| ----------- | -------------- | ------------------ |
| `items`     | `ToastItem[]`  | the toast store    |
| `ondismiss` | `(id) => void` | removes from store |
| `fixed`     | `boolean`      | `true`             |

States: neutral, error (pink border), needs-you (orange; only for "a session needs you").
