# SaveStatus

Inline line for settings that save themselves. Says "Changes save automatically", "Saved" for two seconds after any successful save (`noteSaved()` in `stores/saved.svelte.ts`, called by `api()` for settings routes), "Saving…" while `saving`, and "Not saved: <problem>" when `problem` is set.

| Prop      | Type      | Default | Notes                                                   |
| --------- | --------- | ------- | ------------------------------------------------------- |
| `saving`  | `boolean` | `false` | A save is on its way                                    |
| `problem` | `string`  | `''`    | Why the change was not saved, e.g. "Name needs a value" |

States: idle, saving, saved, problem.
