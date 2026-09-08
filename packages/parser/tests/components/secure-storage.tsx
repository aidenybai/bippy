import { useEffect, useState } from "react";

const DB_NAME = "secure-storage-fixture";
const STORE = "values";
const KEY_ID = "storage-key";
const IV_BYTES = 12;

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const idbGet = <T,>(db: IDBDatabase, id: string): Promise<T | undefined> =>
  new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });

const idbPut = (db: IDBDatabase, id: string, value: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

const hasCrypto = () =>
  typeof window !== "undefined" &&
  typeof window.crypto?.subtle?.encrypt === "function" &&
  typeof window.indexedDB !== "undefined";

let vaultPromise: Promise<{ db: IDBDatabase; key: CryptoKey } | null> | null = null;

const getVault = (): Promise<{ db: IDBDatabase; key: CryptoKey } | null> => {
  if (vaultPromise) return vaultPromise;
  vaultPromise = (async () => {
    if (!hasCrypto()) return null;
    try {
      const db = await openDb();
      const existing = await idbGet<CryptoKey>(db, KEY_ID);
      if (existing) return { db, key: existing };
      const key = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);
      await idbPut(db, KEY_ID, key);
      return { db, key };
    } catch {
      return null;
    }
  })();
  return vaultPromise;
};

const readSecure = async (storageKey: string): Promise<string | null> => {
  const vault = await getVault();
  if (!vault) return window.localStorage.getItem(storageKey);
  const stored = await idbGet<Uint8Array>(vault.db, storageKey);
  if (!stored) return window.localStorage.getItem(storageKey);
  const bytes = new Uint8Array(stored);
  const plaintext = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.subarray(0, IV_BYTES) },
    vault.key,
    bytes.subarray(IV_BYTES),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
};

const writeSecure = async (storageKey: string, value: unknown): Promise<boolean> => {
  const vault = await getVault();
  if (!vault) return false;
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    vault.key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  const payload = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(ciphertext), IV_BYTES);
  await idbPut(vault.db, storageKey, payload);
  return true;
};

const SecureStorage = () => {
  const [draft, setDraft] = useState<"loading" | "empty" | "restored">("loading");
  const [isSaved, setIsSaved] = useState(false);
  const [payloadBytes, setPayloadBytes] = useState<number | null>(null);
  useEffect(() => {
    readSecure("draft").then(async (value) => {
      setDraft(value === null ? "empty" : "restored");
      setIsSaved(await writeSecure("draft", { items: [1, 2, 3] }));
      const vault = await getVault();
      const stored = vault ? await idbGet<Uint8Array>(vault.db, "draft") : undefined;
      setPayloadBytes(stored ? stored.byteLength : null);
    });
  }, []);
  return (
    <p>
      draft {draft}, saved {String(isSaved)}, payload{" "}
      {payloadBytes === null ? "none" : `${payloadBytes} bytes`}
    </p>
  );
};

export default SecureStorage;
