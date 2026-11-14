/**
 * One in-flight/cached request per key, shared by every caller.
 *
 * Used where many components ask for the same server list at once (e.g. every
 * message on screen asking for the conversation's bookmarks on mount). The
 * first call fetches; later calls get the same promise until the key is
 * invalidated. A failed fetch is forgotten so the next call retries.
 */
export function createSharedRequest<T>(fetcher: (key: string) => Promise<T>) {
  const entries = new Map<string, Promise<T>>();

  function get(key: string): Promise<T> {
    let entry = entries.get(key);
    if (!entry) {
      entry = fetcher(key);
      entries.set(key, entry);
      const current = entry;
      entry.catch(() => {
        if (entries.get(key) === current) entries.delete(key);
      });
    }
    return entry;
  }

  function invalidate(key?: string): void {
    if (key === undefined) entries.clear();
    else entries.delete(key);
  }

  return { get, invalidate };
}
