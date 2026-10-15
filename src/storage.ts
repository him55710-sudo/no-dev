import type { SourceFile } from "./core/types";
import { normalizeGlossary, type GlossaryEntry } from "./core/glossary";
function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("pureobom-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("workspace");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function saveWorkspace(
  files: SourceFile[],
  name: string,
  glossary: GlossaryEntry[] = [],
) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("workspace", "readwrite");
    tx.objectStore("workspace").put(
      { version: 1, files, name, glossary },
      "current",
    );
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function loadWorkspace(): Promise<{
  files: SourceFile[];
  name: string;
  glossary: GlossaryEntry[];
} | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("workspace", "readonly");
    const r = tx.objectStore("workspace").get("current");
    r.onsuccess = () => {
      try {
        resolve(
          r.result?.version === 1 && Array.isArray(r.result.files)
            ? {
                files: r.result.files,
                name: r.result.name || "저장된 프로젝트",
                glossary: normalizeGlossary(r.result.glossary),
              }
            : null,
        );
      } catch (error) {
        reject(error);
      }
    };
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => db.close();
  });
}
