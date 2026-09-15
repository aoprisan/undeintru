# Repository Guidelines

## Project Structure & Module Organization

This npm workspace contains a static Romanian high-school admission PWA and its data pipeline.

- `app/src/`: vanilla TypeScript interface, prediction models, shared data schema, CSS, and self-hosted fonts. `app/public/` contains icons and published JSON under `data/v1/`.
- `pipeline/src/`: downloading, parsing, normalization, validation, emission, and exam-data calibration. The pipeline re-exports the app’s schema and models; keep these shared definitions authoritative.
- `pipeline/test/` and `pipeline/fixtures/`: automated tests and committed reference data. Downloaded `pipeline/raw/` and generated `pipeline/normalized/` are ignored by Git.
- `docs/`: UI rationale, model specifications, and project status.

## Build, Test, and Development Commands

Use Node.js 22 or newer, npm, and `just`. Install dependencies with `npm ci`.

- `just dev`: start the Vite development server.
- `just build`: typecheck and build into `app/dist/`.
- `just preview`: serve the production build locally.
- `just check`: run typechecking, ESLint, and tests; required before submitting changes. CI also runs `just build`.
- `just test`: run the Vitest suite; use `npm run test:watch --workspace pipeline` while developing.
- `just harvest SB`: download source pages and stage fixtures for Sibiu.
- `just normalize 2024 SB` then `just emit`: parse downloaded pages, validate, and publish JSON.

## Coding Style & Naming Conventions

Follow existing TypeScript style: two-space indentation, single quotes, semicolons, camelCase functions and variables, and PascalCase types. Use explicit `import type` for type-only imports and `.js` extensions in relative TypeScript imports. Strict TypeScript and type-aware ESLint enforce correctness; no dedicated formatter is configured.

## Testing Guidelines

Name tests `pipeline/test/*.test.ts` and use Vitest `describe`/`it` blocks. Tests must remain offline, using committed fixtures and deterministic seeds. Add regression cases for parser, schema, arithmetic, and model changes. Preserve source `.url` sidecars for fixtures. No numeric code-coverage threshold is configured.

## Commit & Pull Request Guidelines

Use concise imperative commit subjects, following history such as “Reload once when a new service worker takes control.” For pull requests, describe the behavior change, report validation, link relevant issues, and include screenshots for UI changes.

## Data & Architecture Rules

Keep the app free of third-party runtime code, analytics, and external calls. Truncate admission averages to integer hundredths; never round. Respect the 2023 comparability boundary, normalize Romanian diacritics, and preserve synthetic-data provenance and warning banners.
