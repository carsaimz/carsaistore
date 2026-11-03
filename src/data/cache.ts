import type { AppItem, Platform, SourceId } from '../core/models/AppItem';
import { nowIso } from '../core/util';

/**
 * Única fonte de dados da UI. Implementações:
 * - `IdbAppCache`: IndexedDB (navegador/WebView);
 * - `MemoryAppCache`: Map em memória (testes/ambientes sem IndexedDB).
 */
export interface AppCache {
  /** Insere/atualiza itens de uma fonte e registra fetchedAt dela. */
  upsertMany(
    source: SourceId,
    items: AppItem[],
    options?: { /** false = não marcar a fonte como recém-coletada (busca pontual). */
      tocarMeta?: boolean },
  ): Promise<void>;
  getById(id: string): Promise<AppItem | null>;
  getByPlatform(platform: Platform): Promise<AppItem[]>;
  getAll(): Promise<AppItem[]>;
  countByPlatform(platform: Platform): Promise<number>;
  search(platform: Platform, term: string): Promise<AppItem[]>;
  lastFetchedAt(source: SourceId): Promise<string | null>;
  /** Lê um par chave→valor de estado interno (cursor/rotação dos adaptadores). */
  getMeta(chave: string): Promise<string | null>;
  /** Grava um par chave→valor de estado interno. */
  setMeta(chave: string, valor: string): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = 'carsai-store';
// v2: agrupamento de versões — os ids antigos `github:repo@tag` (um card por
// release) são eliminados na migração; os novos são `github:repo#plataforma`.
const DB_VERSION = 2;

/** Ids antigos do GitHub (um item por release/asset) que a v2 substitui. */
const REGEX_ID_ANTIGO_GITHUB = /^github:.+@/;
const STORE_APPS = 'apps';
const STORE_META = 'meta';

interface MetaRecord {
  chave: string;
  valor: string;
}

function pedir<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function esperarTransacao(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class IdbAppCache implements AppCache {
  private db?: Promise<IDBDatabase>;

  private abrir(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const open = indexedDB.open(DB_NAME, DB_VERSION);
        open.onupgradeneeded = (evento) => {
          const db = open.result;
          const versaoAntiga = (evento as IDBVersionChangeEvent).oldVersion;
          if (!db.objectStoreNames.contains(STORE_APPS)) {
            const store = db.createObjectStore(STORE_APPS, { keyPath: 'id' });
            store.createIndex('platform', 'platform', { unique: false });
          } else if (versaoAntiga < 2) {
            // Migração v1→v2: remove os itens antigos “um por release” do
            // GitHub. A sincronização seguinte recria o catálogo agrupado.
            const store = open.transaction!.objectStore(STORE_APPS);
            const pedido = store.openCursor();
            pedido.onsuccess = () => {
              const cursor = pedido.result;
              if (!cursor) return;
              if (REGEX_ID_ANTIGO_GITHUB.test(String(cursor.key))) cursor.delete();
              cursor.continue();
            };
          }
          if (!db.objectStoreNames.contains(STORE_META)) {
            db.createObjectStore(STORE_META, { keyPath: 'chave' });
          }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
    }
    return this.db;
  }

  async upsertMany(
    source: SourceId,
    items: AppItem[],
    options: { tocarMeta?: boolean } = {},
  ): Promise<void> {
    const db = await this.abrir();
    const tx = db.transaction([STORE_APPS, STORE_META], 'readwrite');
    const apps = tx.objectStore(STORE_APPS);
    const meta = tx.objectStore(STORE_META);
    for (const item of items) apps.put(item);
    if (options.tocarMeta !== false) {
      meta.put({ chave: `fetched:${source}`, valor: nowIso() } satisfies MetaRecord);
    }
    await esperarTransacao(tx);
  }

  async getById(id: string): Promise<AppItem | null> {
    const db = await this.abrir();
    const tx = db.transaction(STORE_APPS, 'readonly');
    const reg = (await pedir(tx.objectStore(STORE_APPS).get(id))) as AppItem | undefined;
    return reg ?? null;
  }

  async getByPlatform(platform: Platform): Promise<AppItem[]> {
    const db = await this.abrir();
    const tx = db.transaction(STORE_APPS, 'readonly');
    const regs = (await pedir(
      tx.objectStore(STORE_APPS).index('platform').getAll(platform),
    )) as AppItem[];
    return regs;
  }

  async getAll(): Promise<AppItem[]> {
    const db = await this.abrir();
    const tx = db.transaction(STORE_APPS, 'readonly');
    return pedir(tx.objectStore(STORE_APPS).getAll()) as Promise<AppItem[]>;
  }

  async countByPlatform(platform: Platform): Promise<number> {
    const db = await this.abrir();
    const tx = db.transaction(STORE_APPS, 'readonly');
    return pedir(tx.objectStore(STORE_APPS).index('platform').count(platform));
  }

  async search(platform: Platform, term: string): Promise<AppItem[]> {
    const termo = term.trim().toLowerCase();
    const itens = await this.getByPlatform(platform);
    if (!termo) return itens;
    return itens.filter((a) =>
      [a.name, a.description, a.developer ?? '', a.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(termo),
    );
  }

  async lastFetchedAt(source: SourceId): Promise<string | null> {
    return this.getMeta(`fetched:${source}`);
  }

  async getMeta(chave: string): Promise<string | null> {
    const db = await this.abrir();
    const tx = db.transaction(STORE_META, 'readonly');
    const reg = (await pedir(tx.objectStore(STORE_META).get(chave))) as MetaRecord | undefined;
    return reg?.valor ?? null;
  }

  async setMeta(chave: string, valor: string): Promise<void> {
    const db = await this.abrir();
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put({ chave, valor } satisfies MetaRecord);
    await esperarTransacao(tx);
  }
  async clear(): Promise<void> {
    const db = await this.abrir();
    const tx = db.transaction([STORE_APPS, STORE_META], 'readwrite');
    tx.objectStore(STORE_APPS).clear();
    tx.objectStore(STORE_META).clear();
    await esperarTransacao(tx);
  }
}

export class MemoryAppCache implements AppCache {
  private itens = new Map<string, AppItem>();
  private meta = new Map<string, string>();

  async upsertMany(
    source: SourceId,
    items: AppItem[],
    options: { tocarMeta?: boolean } = {},
  ): Promise<void> {
    for (const item of items) this.itens.set(item.id, item);
    if (options.tocarMeta !== false) this.meta.set(`fetched:${source}`, nowIso());
  }

  async getById(id: string): Promise<AppItem | null> {
    return this.itens.get(id) ?? null;
  }

  async getByPlatform(platform: Platform): Promise<AppItem[]> {
    return [...this.itens.values()].filter((a) => a.platform === platform);
  }

  async getAll(): Promise<AppItem[]> {
    return [...this.itens.values()];
  }

  async countByPlatform(platform: Platform): Promise<number> {
    return (await this.getByPlatform(platform)).length;
  }

  async search(platform: Platform, term: string): Promise<AppItem[]> {
    const termo = term.trim().toLowerCase();
    const itens = await this.getByPlatform(platform);
    if (!termo) return itens;
    return itens.filter((a) =>
      [a.name, a.description, a.developer ?? '', a.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(termo),
    );
  }

  async lastFetchedAt(source: SourceId): Promise<string | null> {
    return this.getMeta(`fetched:${source}`);
  }

  async getMeta(chave: string): Promise<string | null> {
    return this.meta.get(chave) ?? null;
  }

  async setMeta(chave: string, valor: string): Promise<void> {
    this.meta.set(chave, valor);
  }

  async clear(): Promise<void> {
    this.itens.clear();
    this.meta.clear();
  }
}

export function createCache(): AppCache {
  return typeof indexedDB !== 'undefined' ? new IdbAppCache() : new MemoryAppCache();
}
