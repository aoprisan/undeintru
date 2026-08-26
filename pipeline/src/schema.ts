/**
 * Re-export of the shared data contract.
 *
 * The schema lives in `app/src/data/schema.ts` because the app must be able to
 * validate what it loads without depending on the pipeline. The pipeline
 * validates the same shape before it writes, so both sides are held to one
 * definition. This file is the single place that crosses the package boundary.
 */
export * from '../../app/src/data/schema.js';
