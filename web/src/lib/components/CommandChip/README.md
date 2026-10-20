# CommandChip

Commands Claude handed over at the end of its turn (`session.pendingCommands`, fenced as ` ```bash shub-run `), shown under the terminal. Nothing when there are none.

| Prop         | Type                                                                        | Default |
| ------------ | --------------------------------------------------------------------------- | ------- |
| `session`    | `Session`                                                                   |         |
| `phone`      | `boolean`                                                                   | `false` |
| `onterminal` | `() => Promise<string \| null \| undefined>`: opens a shell, returns its id |         |

Open in terminal (the main button) starts a plain shell and types the command in without running it, for sudo and logins. Run in session types `!` plus the command into Claude's prompt (desktop: you press Enter; phone: a second tap, then Enter is sent). Open in terminal and Dismiss clear the list; Copy keeps it.
