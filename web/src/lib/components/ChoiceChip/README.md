# ChoiceChip

Answers Claude's last message offered as an either/or question (`session.pendingChoices`, from a closing `question? (A / B)`), one button per choice above the commands. Nothing when there are none.

| Prop      | Type      | Default |
| --------- | --------- | ------- |
| `session` | `Session` |         |
| `phone`   | `boolean` | `false` |

A click types the choice into Claude's prompt and presses Enter (`POST /api/sessions/:id/choice`). The list clears when the next turn starts.
