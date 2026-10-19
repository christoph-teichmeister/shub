#!/bin/sh
# Claude Code PreToolUse hook: ask shub whether the call would change a protected main checkout and print its
# answer (a deny decision, or {}). Prints nothing when shub is unreachable, so Claude then decides as usual.
[ -n "$SHUB_URL" ] && [ -n "$SHUB_TOKEN" ] || { cat >/dev/null; exit 0; }
curl -s -f -m 4 -X POST -H "Authorization: Bearer $SHUB_TOKEN" -H 'content-type: application/json' \
  --data-binary @- "$SHUB_URL/api/guard" 2>/dev/null || true
exit 0
