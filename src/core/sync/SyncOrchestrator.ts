import type { SourceAdapter } from '../adapters/SourceAdapter';
import type { AppCache } from '../../data/cache';

/** Intervalo da sincronização automática: 24 horas. */
export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface SyncProgress {
  source: string;
  status: 'inicio' | 'ok' | 'falha';
  total?: number;
  error?: string;
}

export type SyncListener = (progresso: SyncProgress) => void;

/**
 * Sincroniza TODAS as fontes, uma a uma. Regras do documento:
 * - a falha de UMA fonte não interrompe as demais;
 * - em falha, o cache anterior da fonte é preservado;
 * - a UI apenas é avisada via listener (para mostrar progresso).
 */
export async function syncAll(
  adapters: SourceAdapter[],
  cache: AppCache,
  onProgress?: SyncListener,
): Promise<void> {
  for (const adapter of adapters) {
    onProgress?.({ source: adapter.source, status: 'inicio' });
    try {
      const items = await adapter.fetchAll();
      await cache.upsertMany(adapter.source, items);
      onProgress?.({ source: adapter.source, status: 'ok', total: items.length });
    } catch (error) {
      console.warn(`Falha ao sincronizar ${adapter.source}:`, error);
      onProgress?.({ source: adapter.source, status: 'falha', error: String(error) });
    }
  }
}

/**
 * Roda `syncAll` apenas se alguma fonte passou de 24 h sem coleta.
 * Devolve true quando a sincronização aconteceu. NUNCA chamar no caminho
 * crítico de busca/detalhe — só em fundo, na abertura do catálogo.
 */
export async function syncIfStale(
  adapters: SourceAdapter[],
  cache: AppCache,
  agora = Date.now(),
): Promise<boolean> {
  const stamps = await Promise.all(adapters.map((a) => cache.lastFetchedAt(a.source)));
  const desatualizado = stamps.some((s) => !s || agora - Date.parse(s) > SYNC_INTERVAL_MS);
  if (!desatualizado) return false;
  await syncAll(adapters, cache);
  return true;
}
