import type { AppItem, Platform, SourceId } from '../models/AppItem';

/**
 * Cada fonte de dados expõe exatamente um adaptador que sabe:
 * 1. coletar (fetch) os dados brutos da API pública; e
 * 2. normalizá-los para `AppItem`.
 *
 * O `SyncOrchestrator` itera sobre os adaptadores; a UI nunca os vê.
 */
export interface SourceAdapter {
  readonly source: SourceId;
  /** Plataforma “âncora” da fonte (o GitHub, p.ex., deriva por item). */
  readonly platform: Platform;
  fetchAll(): Promise<AppItem[]>;
}
