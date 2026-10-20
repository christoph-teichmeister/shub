# UpdateCurtain

Full-screen blur for the reload after an update, so it does not look like a flicker. Mount one `<UpdateCurtain version={app.reloadingTo} />` in the app.

| Prop      | Type             | Default |
| --------- | ---------------- | ------- |
| `version` | `string \| null` | `null`  |

States: hidden; updating (blurs the UI and shows the shub wordmark while `loadUpdate()` waits before `location.reload()`); arrived (the reloaded page starts covered, fades out and toasts "Updated to shub x"). The handover goes through `sessionStorage['shub-updated']`. No fades with reduced motion.
