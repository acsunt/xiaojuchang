/**
 * 自定义背景图的本地持久化层（IndexedDB 版）。
 *
 * 设计要点：
 * 1. 不再把图片 base64 塞进 localStorage,避免 5~10MB 配额撞顶
 *    导致背景图"莫名其妙丢失"。
 * 2. IndexedDB 可以直接存 Blob,体积上限一般是磁盘级别,
 *    而且读写都是异步事务,不会阻塞 UI。
 * 3. localStorage.site-theme-config 里仍然保留 bgType / bgValue,
 *    但语义改了:
 *      - bgType === 'image' 时, bgValue 是 IndexedDB 的 key(固定 'current')
 *      - bgType === 'url'   时, bgValue 是远程 URL 字符串
 *    这样本地配置不会被图片本体污染。
 * 4. 只保留一条记录（key='current'）,避免累积垃圾数据;
 *    如果未来需要多背景图轮播,把这里扩成多条记录即可。
 */
export type BackgroundRecordType = 'image' | 'url';

export interface BackgroundRecord {
  id: 'current';
  type: BackgroundRecordType;
  /** 'image' 时是 Blob（图片本体）;'url' 时是远程 URL 字符串。*/
  value: Blob | string;
  mime: string;
  updatedAt: number;
}

const DB_NAME = 'mini-theater-bg';
const DB_VERSION = 1;
const STORE_NAME = 'backgrounds';
const RECORD_ID = 'current' as const;

/** 配置里 bgValue 字段在 'image' 类型下存的就是这个 key,用来回查 IndexedDB。*/
export const BACKGROUND_BLOB_KEY = RECORD_ID;

let dbPromise: Promise<IDBDatabase> | null = null;

const isIndexedDBAvailable = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return 'indexedDB' in window && window.indexedDB !== null;
  } catch {
    return false;
  }
};

const openDb = (): Promise<IDBDatabase> => {
  if (!isIndexedDBAvailable()) {
    return Promise.reject(new Error('IndexedDB 不可用'));
  }
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
    req.onblocked = () => reject(new Error('IndexedDB 被其他标签页阻塞'));
  });
  /* 失败后允许重试：清掉缓存的 promise */
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
};

const runTransaction = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | IDBRequest<unknown>,
): Promise<T> => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let result: T;
    const req = run(store);
    req.onsuccess = () => {
      result = req.result as T;
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 请求失败'));
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务被中止'));
  });
};

export const getBackgroundRecord = async (): Promise<BackgroundRecord | null> => {
  if (!isIndexedDBAvailable()) return null;
  try {
    const found = await runTransaction<BackgroundRecord | undefined>('readonly', (store) =>
      store.get(RECORD_ID),
    );
    return found ?? null;
  } catch (err) {
    console.warn('[bg-store] 读取背景失败:', err);
    return null;
  }
};

export const saveBackgroundBlob = async (blob: Blob, mime = blob.type || 'image/jpeg'): Promise<string> => {
  if (!isIndexedDBAvailable()) {
    throw new Error('IndexedDB 不可用,无法保存图片');
  }
  const record: BackgroundRecord = {
    id: RECORD_ID,
    type: 'image',
    value: blob,
    mime,
    updatedAt: Date.now(),
  };
  await runTransaction<IDBValidKey>('readwrite', (store) => store.put(record));
  return RECORD_ID;
};

/**
 * 从 data URL(data:image/...;base64,...)解码成 Blob 并保存。
 * 兼容 canvas.toDataURL 的同步输出。
 */
export const saveBackgroundFromDataUrl = async (dataUrl: string): Promise<string> => {
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) {
    throw new Error('data URL 解析失败');
  }
  return saveBackgroundBlob(blob, blob.type || 'image/jpeg');
};

const dataUrlToBlob = (dataUrl: string): Blob | null => {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) return null;
  try {
    const mime = match[1];
    const bin = atob(match[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
};

export const saveBackgroundUrl = async (url: string): Promise<string> => {
  if (!isIndexedDBAvailable()) {
    throw new Error('IndexedDB 不可用,无法保存配置');
  }
  const record: BackgroundRecord = {
    id: RECORD_ID,
    type: 'url',
    value: url,
    mime: '',
    updatedAt: Date.now(),
  };
  await runTransaction<IDBValidKey>('readwrite', (store) => store.put(record));
  return RECORD_ID;
};

export const clearBackground = async (): Promise<void> => {
  if (!isIndexedDBAvailable()) return;
  try {
    await runTransaction<undefined>('readwrite', (store) => store.clear());
  } catch (err) {
    console.warn('[bg-store] 清空背景失败:', err);
  }
};

/**
 * 把图片 Blob 转成可给 backgroundImage 用的临时 URL。
 * 每次产生新的 object URL 都记下来,组件卸载或切图时统一 revoke,
 * 避免内存泄漏。
 */
const liveObjectUrls = new Set<string>();

export const createBlobUrl = (blob: Blob): string => {
  const url = URL.createObjectURL(blob);
  liveObjectUrls.add(url);
  return url;
};

export const revokeAllBlobUrls = (): void => {
  for (const url of liveObjectUrls) {
    URL.revokeObjectURL(url);
  }
  liveObjectUrls.clear();
};

/* ============================================================
 *  下载相关
 * ============================================================ */

/**
 * 把 Blob 触发成浏览器下载。
 * 文件名带 yyyy-mm-dd-hhmm 后缀,避免重复下载被自动覆盖。
 */
export const downloadBlob = (blob: Blob, filenameBase = '背景图'): void => {
  if (typeof window === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ext = blob.type.includes('png')
    ? 'png'
    : blob.type.includes('webp')
      ? 'webp'
      : 'jpg';
  const now = new Date();
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  a.href = url;
  a.download = `${filenameBase}-${stamp}.${ext}`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  /* 给浏览器一点时间把 click 派发出去,再移除 + revoke */
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
};

const pad = (n: number): string => String(n).padStart(2, '0');
