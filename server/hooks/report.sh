#!/bin/sh
# Claude Code hook: forward the event JSON on stdin to shub. Never prints, never fails, so it
# cannot block Claude or change its decision (stdout of UserPromptSubmit would land in the context).
[ -n "$SHUB_URL" ] && [ -n "$SHUB_TOKEN" ] || { cat >/dev/null; exit 0; }
curl -s -m 2 -X POST -H "Authorization: Bearer $SHUB_TOKEN" -H 'content-type: application/json' \
  --data-binary @- "$SHUB_URL/api/hooks/$1" >/dev/null 2>&1 || true
exit 0
