import { useState, useEffect, useCallback, useRef } from 'react';

const DB_NAME = 'offline-media';
const DB_VERSION = 1;
const STORE_NAME = 'files';

export interface OfflineFileMeta {
  key: string;          // "folderKey/subpath/filename" or "folderKey/filename"
  folderKey: string;
  subpath: string;
  name: string;
  size: number;
  mediaType: string | null;
  savedAt: string;      // ISO date
}

interface OfflineFileRecord extends OfflineFileMeta {
  blob: Blob;
}

function buildKey(folderKey: string, subpath: string, filename: string): string {
  return subpath ? `${folderKey}/${subpath}/${filename}` : `${folderKey}/${filename}`;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('folderKey', 'folderKey', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllMeta(): Promise<OfflineFileMeta[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      // Strip blob from results to keep memory light
      const items: OfflineFileMeta[] = (req.result as OfflineFileRecord[]).map(
        ({ key, folderKey, subpath, name, size, mediaType, savedAt }) =>
          ({ key, folderKey, subpath, name, size, mediaType, savedAt }),
      );
      resolve(items);
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function getBlob(key: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => {
      const record = req.result as OfflineFileRecord | undefined;
      resolve(record?.blob ?? null);
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function putFile(record: OfflineFileRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function deleteFile(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export function useOfflineStore() {
  const [files, setFiles] = useState<OfflineFileMeta[]>([]);
  const [offlineKeys, setOfflineKeys] = useState<Set<string>>(new Set());
  const [totalSize, setTotalSize] = useState(0);
  const [saving, setSaving] = useState<string | null>(null); // key currently being saved
  const [saveError, setSaveError] = useState<string | null>(null);
  const blobUrlCache = useRef<Map<string, string>>(new Map());

  const refresh = useCallback(async () => {
    const all = await getAllMeta();
    setFiles(all);
    setOfflineKeys(new Set(all.map(f => f.key)));
    setTotalSize(all.reduce((sum, f) => sum + f.size, 0));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Clean up blob URLs on unmount
  useEffect(() => {
    const cache = blobUrlCache.current;
    return () => {
      cache.forEach(url => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, []);

  const isOffline = useCallback((folderKey: string, subpath: string, filename: string): boolean => {
    return offlineKeys.has(buildKey(folderKey, subpath, filename));
  }, [offlineKeys]);

  const saveOffline = useCallback(async (
    fileUrl: string,
    folderKey: string,
    subpath: string,
    filename: string,
    mediaType: string | null,
  ): Promise<void> => {
    const key = buildKey(folderKey, subpath, filename);
    setSaving(key);
    setSaveError(null);
    try {
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const blob = await res.blob();
      await putFile({
        key,
        folderKey,
        subpath,
        name: filename,
        size: blob.size,
        mediaType,
        savedAt: new Date().toISOString(),
        blob,
      });
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save offline';
      setSaveError(msg);
      throw err;
    } finally {
      setSaving(null);
    }
  }, [refresh]);

  const removeOffline = useCallback(async (folderKey: string, subpath: string, filename: string): Promise<void> => {
    const key = buildKey(folderKey, subpath, filename);
    // Revoke blob URL if cached
    const cached = blobUrlCache.current.get(key);
    if (cached) {
      URL.revokeObjectURL(cached);
      blobUrlCache.current.delete(key);
    }
    await deleteFile(key);
    await refresh();
  }, [refresh]);

  const getOfflineUrl = useCallback(async (folderKey: string, subpath: string, filename: string): Promise<string | null> => {
    const key = buildKey(folderKey, subpath, filename);
    // Return cached blob URL if available
    const cached = blobUrlCache.current.get(key);
    if (cached) return cached;
    const blob = await getBlob(key);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    blobUrlCache.current.set(key, url);
    return url;
  }, []);

  const isSaving = useCallback((folderKey: string, subpath: string, filename: string): boolean => {
    return saving === buildKey(folderKey, subpath, filename);
  }, [saving]);

  const clearSaveError = useCallback(() => setSaveError(null), []);

  return {
    offlineFiles: files,
    offlineKeys,
    totalSize,
    isOffline,
    isSaving,
    saveError,
    clearSaveError,
    saveOffline,
    removeOffline,
    getOfflineUrl,
    refresh,
  };
}
