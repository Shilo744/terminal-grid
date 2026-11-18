#!/bin/bash
# Terminal Grid ל-macOS: לחיצה כפולה ב-Finder מפעילה אותו (בפעם הראשונה: chmod +x "Terminal Grid.command" ו-npm ci).
# אפשר גם לגרור את הקובץ ל-Dock, או לשלוח אליו תיקייה: ./"Terminal Grid.command" ~/project
cd "$(dirname "$0")" || exit 1
for p in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do [ -d "$p" ] && PATH="$p:$PATH"; done
export PATH
if [ ! -d node_modules ]; then npm ci --no-audit --no-fund || exit 1; fi
exec node start.mjs "$@"
