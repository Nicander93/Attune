import type { Material } from './domain';
let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('attune', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('materials', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('数据库被其他窗口占用，请关闭其他窗口再重试。'));
  }));
}
export async function loadMaterials(): Promise<Material[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('materials', 'readonly').objectStore('materials').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveMaterial(material: Material): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('materials', 'readwrite');
    transaction.objectStore('materials').put(material);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
