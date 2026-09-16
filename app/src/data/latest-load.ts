/** Only the latest selection may publish either data or a recoverable error. */
export function latestLoad<T>(load: (key: string) => Promise<T>): (key: string) => Promise<
  { kind: 'ready'; value: T } | { kind: 'error' } | { kind: 'stale' }
> {
  let generation = 0;
  return async (key) => {
    const request = ++generation;
    try {
      const value = await load(key);
      return request === generation ? { kind: 'ready', value } : { kind: 'stale' };
    } catch {
      return request === generation ? { kind: 'error' } : { kind: 'stale' };
    }
  };
}
