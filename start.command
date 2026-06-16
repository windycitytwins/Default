#!/bin/bash
# Double-click this file (macOS) to start Chart School, then open
# http://localhost:8123 in your browser. Press Ctrl+C in the window to stop.
cd "$(dirname "$0")" || exit 1
echo ""
echo "  Starting Chart School…  (open http://localhost:8123 once it's running)"
echo ""
node server.js
