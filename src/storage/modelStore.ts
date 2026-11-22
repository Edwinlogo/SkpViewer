import type { ModelFormat, SavedModelMeta, SavedModelRecord, ViewerScene } from '../types/viewer';

const DB_NAME = 'skpxr-offline-library';
const DB_VERSION = 1;
const STORE_MODELS = 'models';
const STORE_SCENES = 'custom_scenes';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MODELS)) {
        const store = db.createObjectStore(STORE_MODELS, { keyPath: 'id' });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SCENES)) {
        db.createObjectStore(STORE_SCENES, { keyPath: 'modelId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir IndexedDB'));
  });
}

export async function saveModelOffline(params: {
  id: string;
  name: string;
  format: ModelFormat;
  data: ArrayBuffer;
  thumbnailDataUrl?: string;
}): Promise<SavedModelMeta> {
  const db = await openDatabase();
  const record: SavedModelRecord = {
    id: params.id,
    name: params.name,
    format: params.format,
    size: params.data.byteLength,
    savedAt: Date.now(),
    thumbnailDataUrl: params.thumbnailDataUrl,
    data: params.data,
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_MODELS, 'readwrite');
    tx.objectStore(STORE_MODELS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Error guardando modelo offline'));
  });
  db.close();
  return {
    id: record.id,
    name: record.name,
    format: record.format,
    size: record.size,
    savedAt: record.savedAt,
    thumbnailDataUrl: record.thumbnailDataUrl,
  };
}

export async function listSavedModels(): Promise<SavedModelMeta[]> {
  try {
    const db = await openDatabase();
    const metas = await new Promise<SavedModelMeta[]>((resolve, reject) => {
      const tx = db.transaction(STORE_MODELS, 'readonly');
      const req = tx.objectStore(STORE_MODELS).getAll();
      req.onsuccess = () => {
        const records = (req.result as SavedModelRecord[]) ?? [];
        const items: SavedModelMeta[] = records
          .map((r) => ({
            id: r.id,
            name: r.name,
            format: r.format,
            size: r.size,
            savedAt: r.savedAt,
            thumbnailDataUrl: r.thumbnailDataUrl,
          }))
          .sort((a, b) => b.savedAt - a.savedAt);
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
    db.close();
    return metas;
  } catch {
    return [];
  }
}

export async function getSavedModel(id: string): Promise<SavedModelRecord | null> {
  const db = await openDatabase();
  const rec = await new Promise<SavedModelRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE_MODELS, 'readonly');
    const req = tx.objectStore(STORE_MODELS).get(id);
    req.onsuccess = () => resolve((req.result as SavedModelRecord) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rec;
}

export async function deleteSavedModel(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_MODELS, STORE_SCENES], 'readwrite');
    tx.objectStore(STORE_MODELS).delete(id);
    tx.objectStore(STORE_SCENES).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function saveCustomScenes(modelId: string, scenes: ViewerScene[]): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SCENES, 'readwrite');
    tx.objectStore(STORE_SCENES).put({ modelId, scenes, updatedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadCustomScenes(modelId: string): Promise<ViewerScene[]> {
  try {
    const db = await openDatabase();
    const scenes = await new Promise<ViewerScene[]>((resolve, reject) => {
      const tx = db.transaction(STORE_SCENES, 'readonly');
      const req = tx.objectStore(STORE_SCENES).get(modelId);
      req.onsuccess = () => {
        const res = req.result as { scenes?: ViewerScene[] } | undefined;
        resolve(res?.scenes ?? []);
      };
      req.onerror = () => reject(req.error);
    });
    db.close();
    return scenes;
  } catch {
    return [];
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
