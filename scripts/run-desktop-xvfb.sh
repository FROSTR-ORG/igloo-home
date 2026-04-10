#!/usr/bin/env bash
set -euo pipefail

if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "igloo-home desktop smoke via xvfb requires 'xvfb-run' to be installed" >&2
  exit 1
fi

export IGLOO_HOME_RUN_DESKTOP_TESTS=1

exec xvfb-run -a -s "-screen 0 1440x940x24" node ./test/desktop/run.mjs
