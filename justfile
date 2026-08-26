# undeintru — task runner
# Usage: `just <recipe>`; `just` on its own lists everything.

set shell := ["bash", "-uc"]

default:
    @just --list

# --- app -------------------------------------------------------------------

# Vite dev server for the PWA
dev:
    npm run dev --workspace app

# Production build -> app/dist
build:
    npm run build --workspace app

# Preview the production build
preview:
    npm run preview --workspace app

# --- pipeline --------------------------------------------------------------

# Download the raw admitere.edu.ro pages for a year into pipeline/raw/ (gitignored).
# Network-only; never run by tests or CI.
fetch year county="SB":
    npm run --workspace pipeline --silent cli -- fetch --year {{year}} --county {{county}}

# Parse pipeline/raw/ into normalized rows -> pipeline/normalized/<year>/<county>.json
normalize year county="SB":
    npm run --workspace pipeline --silent cli -- normalize --year {{year}} --county {{county}}

# Write SYNTHETIC data for validating the pipeline and the prediction model.
# Not real cutoffs -- every row is stamped provenance: synthetic.
mock county="SB":
    npm run --workspace pipeline --silent cli -- mock --county {{county}}

# Emit validated public data -> app/public/data/v1/
emit:
    npm run --workspace pipeline --silent cli -- emit

# --- quality ---------------------------------------------------------------

typecheck:
    npm run typecheck --workspace app
    npm run typecheck --workspace pipeline

lint:
    npx eslint .

test:
    npm run test --workspace pipeline

# Everything CI runs. Offline: no recipe here touches the network.
check: typecheck lint test
