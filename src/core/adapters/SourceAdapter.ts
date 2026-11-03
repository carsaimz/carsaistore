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
  /**
   * Coleta os itens da fonte. `onPartial` (opcional) recebe lotes à medida
   * que são normalizados — o orquestrador persiste cada lote imediatamente,
   * para que uma falha no meio da coleta não perca o que já foi obtido.
   * Os adaptadores podem ignorá-lo e devolver tudo de uma vez.
   */
  fetchAll(onPartial?: (lote: AppItem[]) => void | Promise<void>): Promise<AppItem[]>;
}
