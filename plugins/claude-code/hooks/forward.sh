#!/bin/sh
# Forwards a hook event to Lumen, naming the app ($1) it came from. Lumen writes curl.conf while it runs, so without it
# this ends at once. Any failure ends quietly too: the app would show a non-zero exit as a hook error.
[ -f "$HOME/.lumen/curl.conf" ] || exit 0
curl -K "$HOME/.lumen/curl.conf" -H "X-Lumen-App: $1" --data-binary @- 2>/dev/null || :
