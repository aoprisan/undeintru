#!/usr/bin/env bash
# Populate the real cutoffs: the network half of the job, from a machine that
# can reach admitere.edu.ro. Runs `harvest` for every comparable year and
# stages fixtures ready to commit. Needs Node 22+ and npm; `just` is optional.
#
#   scripts/populate.sh                 SB, 2023-2026, 3 fixtures per year
#   scripts/populate.sh SB 2024,2025    a county and a year list
#   scripts/populate.sh SB 2024 --discover        print the URLs and stop
#   scripts/populate.sh SB 2024 --all-fixtures    stage every page of the year
#
# Any further flags go straight to the harvest command (see `npm run
# --workspace pipeline cli` for the list).
set -euo pipefail

county="${1:-SB}"
years="${2:-2023,2024,2025,2026}"
shift $(( $# >= 2 ? 2 : $# ))

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if ! command -v node >/dev/null 2>&1; then
  echo "node is not installed; this needs Node 22 or newer (https://nodejs.org)." >&2
  exit 1
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 22 ]; then
  echo "Node $(node --version) is too old; this needs Node 22 or newer." >&2
  exit 1
fi

if [ "${CI:-}" = "true" ] || [ "${UNDEINTRU_OFFLINE:-}" = "1" ]; then
  echo "CI=true or UNDEINTRU_OFFLINE=1 is set; the pipeline refuses the network under either. Unset it to fetch." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  # --ignore-scripts is already the repository default (.npmrc); repeated here
  # so it holds even if npm is run with a config that overrides it.
  echo "Installing dependencies (npm ci --ignore-scripts)..."
  npm ci --ignore-scripts --no-audit --no-fund
fi

if command -v curl >/dev/null 2>&1 && [[ " $* " != *" --stage-only "* ]]; then
  echo "Checking that admitere.edu.ro answers..."
  if ! probe="$(curl -sS -o /dev/null --max-time 20 https://admitere.edu.ro/ 2>&1)"; then
    echo "admitere.edu.ro did not answer: $probe" >&2
    echo "The ministry takes the portal down between admission cycles; try again when it is up." >&2
    echo "(Pages already in pipeline/raw/ can still be staged with: scripts/populate.sh $county $years --stage-only)" >&2
    exit 1
  fi
fi

exec npm run --workspace pipeline --silent cli -- harvest --county "$county" --years "$years" "$@"
