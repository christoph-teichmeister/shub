# UpdateCurtain

Full-screen blur for the reload after an update, so it does not look like a flicker. Mount one `<UpdateCurtain version={app.reloadingTo} />` in the app.

| Prop      | Type             | Default |
| --------- | ---------------- | ------- |
| `version` | `string \| null` | `null`  |

States: hidden; updating (lightly blurs the UI (2px) and shows the shub wordmark on a panel-coloured badge while `loadUpdate()` waits before `location.reload()`); arrived (the reloaded page starts covered by the opaque background, waits for `app.ready` and the fonts, then fades out and toasts "Updated to shub x" with the release notes since the version it replaced, kept until closed; without notes (GitHub unreachable) a plain 4 s toast). The handover goes through `sessionStorage['shub-updated']`. No fades with reduced motion.
