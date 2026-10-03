/** Photos stay on this device, separate from server job data. Keep only recent scan previews. */
let database;
function openDatabase() {
  return database ??= new Promise((resolve, reject) => {
  const request = indexedDB.open('pantry-scan-photos', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('photos');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  });
}

export async function saveScanPhotos(jobId, images) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    store.put(images, jobId);
    const keys = store.getAllKeys();
    keys.onsuccess = () => keys.result.sort((a, b) => b - a).slice(5).forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadScanPhotos(jobId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('photos').objectStore('photos').get(jobId);
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}
