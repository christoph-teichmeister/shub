# StatusBadge

Pill with a count or short status, e.g. "1 needs you" on a project row or a plugin section.

| Prop   | Type                                              | Default     |
| ------ | ------------------------------------------------- | ----------- |
| `text` | `string`                                          |             |
| `tone` | `'needs-you' \| 'working' \| 'done' \| 'neutral'` | `'neutral'` |

States: `needs-you` solid orange (only for sessions that need the user), `working` cyan outline, `done` green outline, `neutral` grey fill.
