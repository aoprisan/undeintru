/**
 * Re-export of the shared prediction model.
 *
 * The model lives in `app/src/model/predict.ts` because the app runs it in the
 * browser; the pipeline imports it here so the validation suite exercises the
 * exact code the app ships, not a copy that can drift from it.
 */
export * from '../../app/src/model/predict.js';
