#!/bin/sh
# Forwards a Claude Code hook event to Lumen. Lumen writes curl.conf while it runs, so without it this ends at once.
# Any failure ends quietly too: Claude Code would show a non-zero exit as a hook error.
[ -f "$HOME/.lumen/curl.conf" ] || exit 0
curl -K "$HOME/.lumen/curl.conf" --data-binary @- 2>/dev/null || :
