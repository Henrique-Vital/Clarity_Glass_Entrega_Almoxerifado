const DB_NAME = 'portaria-clarity';
const DB_VERSION = 1;
const STORE = 'registros';

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Este navegador não suporta IndexedDB.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('dataHoraEntrada', 'dataHoraEntrada', { unique: false });
        store.createIndex('status', 'status', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao abrir o banco local.'));
    request.onblocked = () => reject(new Error('O banco local está bloqueado. Feche outras abas do app.'));
  });

  return dbPromise;
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function listarRegistros() {
  const db = await openDatabase();
  const transaction = db.transaction(STORE, 'readonly');
  const request = transaction.objectStore(STORE).getAll();
  const records = await requestAsPromise(request);
  return Array.isArray(records) ? records : [];
}

export async function salvarRegistro(record) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(record);
    transaction.oncomplete = () => resolve(record);
    transaction.onerror = () => reject(transaction.error || new Error('Falha ao salvar o registro.'));
    transaction.onabort = () => reject(transaction.error || new Error('Gravação cancelada.'));
  });
}

export async function apagarRegistro(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Falha ao apagar o registro.'));
  });
}

export async function apagarTodos() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Falha ao apagar os registros.'));
  });
}

export async function importarRegistros(records) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const existingRequest = store.getAll();
    let newCount = 0;
    let updatedCount = 0;

    existingRequest.onsuccess = () => {
      const existingIds = new Set(existingRequest.result.map((item) => item.id));
      for (const record of records) {
        if (existingIds.has(record.id)) {
          updatedCount += 1;
        } else {
          newCount += 1;
        }
        store.put(record);
      }
    };

    transaction.oncomplete = () => resolve({ novos: newCount, atualizados: updatedCount });
    transaction.onerror = () => reject(transaction.error || new Error('Falha ao importar o backup.'));
    transaction.onabort = () => reject(transaction.error || new Error('Importação cancelada.'));
  });
}

export async function contarRegistros() {
  const db = await openDatabase();
  const transaction = db.transaction(STORE, 'readonly');
  const request = transaction.objectStore(STORE).count();
  return requestAsPromise(request);
}
