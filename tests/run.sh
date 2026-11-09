#!/bin/sh
# Runs each Classroom++ fixture in headless Chrome and reports PASS/FAIL.
# Usage: sh tests/run.sh   (override the binary with CHROME=/path/to/chrome)
set -eu
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
STATUS=0

for FIXTURE in tests/classwork-fixture.html tests/to-review-fixture.html tests/stream-fixture.html tests/archived-classwork-fixture.html tests/visibility-fixture.html; do
  echo "== $FIXTURE"
  OUT="$(mktemp -t classroompp-test).html"

  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --virtual-time-budget=20000 \
    --dump-dom "file://$PWD/$FIXTURE" > "$OUT"

  # Pull the #results text out of the dumped DOM.
  python3 - "$OUT" <<'EOF' || STATUS=1
import re, sys
html = open(sys.argv[1]).read()
m = re.search(r'<div id="results">(.*?)</div>', html, re.S)
text = (m.group(1) if m else 'NO RESULTS FOUND')
text = re.sub(r'<[^>]+>', '', text)
print(text.strip())
sys.exit(0 if 'ALL TESTS PASSED' in text else 1)
EOF
done

exit $STATUS
