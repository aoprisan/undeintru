import { describe, expect, it } from 'vitest';
import { latestLoad } from '../../app/src/data/latest-load.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('county selection loading', () => {
  it.each(['success', 'failure'] as const)('ignores an older %s after a newer selection completes', async (outcome) => {
    const older = deferred<string>();
    const load = latestLoad((key: string) => key === 'AB' ? older.promise : Promise.resolve(key));
    const pending = load('AB');
    expect(await load('SB')).toEqual({ kind: 'ready', value: 'SB' });
    if (outcome === 'success') older.resolve('AB');
    else older.reject(new Error('offline'));
    expect(await pending).toEqual({ kind: 'stale' });
  });

  it('allows retrying the same county after a failed request', async () => {
    let attempts = 0;
    const load = latestLoad((key: string) => ++attempts === 1
      ? Promise.reject(new Error('offline')) : Promise.resolve(key));
    expect(await load('CJ')).toEqual({ kind: 'error' });
    expect(await load('CJ')).toEqual({ kind: 'ready', value: 'CJ' });
  });
});
