#!/bin/sh
# Claude Code status line: hand Claude Code's own context window to shub (the transcript does not always tell it),
# then draw the user's own status line ($1, their statusLine command) from the same input.
input=$(cat)
if [ -n "$SHUB_URL" ] && [ -n "$SHUB_TOKEN" ]; then
  printf '%s' "$input" | curl -s -m 2 -X POST -H "Authorization: Bearer $SHUB_TOKEN" \
    -H 'content-type: application/json' --data-binary @- "$SHUB_URL/api/hooks/StatusLine" >/dev/null 2>&1 &
fi
[ -n "$1" ] && printf '%s' "$input" | bash -c "$1"
exit 0
