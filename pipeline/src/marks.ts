/**
 * Re-export of the shared marks model.
 *
 * Like `model.ts`: the marks model lives in `app/src/model/marks.ts` because
 * the app runs it in the browser; the pipeline imports it here so the
 * validation suite exercises the exact code the app ships.
 */
export * from '../../app/src/model/marks.js';
