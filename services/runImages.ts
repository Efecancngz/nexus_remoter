const DB_NAME = 'nexus_agent_images';
const STORE = 'runImages';

export function idsToDelete(existingIds: string[], keepIds: string[]): string[] {
  const keep = new Set(keepIds);
  return existingIds.filter(id => !keep.has(id));
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'runId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRunImages(runId: string, images: (string | null)[]): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ runId, images });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB unavailable — degrade to no persistence.
  }
}

export async function loadRunImages(runId: string): Promise<(string | null)[] | null> {
  try {
    const db = await openDB();
    const result = await new Promise<(string | null)[] | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(runId);
      req.onsuccess = () => resolve(req.result ? req.result.images : null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function reconcileRunImages(keepIds: string[]): Promise<void> {
  try {
    const db = await openDB();
    const existing = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => reject(req.error);
    });
    const toDelete = idsToDelete(existing, keepIds);
    if (toDelete.length > 0) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        toDelete.forEach(id => store.delete(id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    db.close();
  } catch {
    // IndexedDB unavailable — no-op.
  }
}
