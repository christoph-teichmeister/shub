# AgentRow

A subagent running inside a Claude session (an Agent call, a forked skill such as `code-review`), nested under that session in the sidebar next to its worktrees. Shows a sparkle mark (worktrees show a folder), the agent type and its last tool call. Not clickable: a subagent has no pane of its own; Claude's footer in the session is its live view. The row goes when its SubagentStop hook arrives.

| Prop    | Type          | Default |
| ------- | ------------- | ------- |
| `agent` | `SubagentRun` |         |

States: working (activity unknown yet), with activity (the last tool call, full text on hover).
