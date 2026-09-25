export type Capture = {
  id: string;
  sessionId: string | null;
  label: string;
  createdAt: number;
  elapsedMs: number;
  width: number;
  height: number;
  blob: Blob;
  changePercent?: number;
  kind?: 'manual' | 'automatic';
  sourceLabel?: string;
};
let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tempo-captures', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('captures', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error('Close other Trace tabs and try again.'));
    }).catch((error) => {
      database = undefined;
      throw error;
    });
  }
  return database;
}
export async function listCaptures(): Promise<Capture[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('captures').objectStore('captures').getAll();
    request.onsuccess = () =>
      resolve(
        (request.result as Capture[]).sort((a, b) => b.createdAt - a.createdAt),
      );
    request.onerror = () => reject(request.error);
  });
}
export async function saveCapture(capture: Capture) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('captures', 'readwrite');
    transaction.objectStore('captures').put(capture);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
export async function deleteCapture(id: string) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('captures', 'readwrite');
    transaction.objectStore('captures').delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
