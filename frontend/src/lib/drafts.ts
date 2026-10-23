// Per-post local drafts in IndexedDB: the offline safety net. Keyed by
// `${repoId}:${path}`. Failures (private mode, blocked storage) are silent.

export interface Draft { content: string; baseBlob: string | null; savedAt: number }

const DB = 'md_editor';
const STORE = 'drafts';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => { resolve(r.result as T); db.close(); };
      t.onerror = () => { reject(t.error); db.close(); };
    });
  } catch {
    return undefined;
  }
}

const key = (repoId: number, path: string) => `${repoId}:${path}`;

export const drafts = {
  get: (repoId: number, path: string) => tx<Draft>('readonly', (s) => s.get(key(repoId, path))),
  put: (repoId: number, path: string, d: Draft) => tx('readwrite', (s) => s.put(d, key(repoId, path))),
  clear: (repoId: number, path: string) => tx('readwrite', (s) => s.delete(key(repoId, path))),
};
