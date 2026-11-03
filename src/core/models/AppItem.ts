/**
 * Contrato de dados unificado do Carsai Store.
 *
 * A UI NUNCA fala com APIs externas: ela só conhece `AppItem`, normalizado por
 * um adaptador por fonte e persistido no cache local. `id` é determinístico e
 * imutável — sempre `${source}:${idOriginal}`.
 */
export type Platform = 'android' | 'ios' | 'desktop';

export type SourceId = 'fdroid' | 'github' | 'itunes' | 'homebrew' | 'flathub' | 'winget';

/**
 * Uma versão concreta e baixável de um app. As fontes que publicam histórico
 * (GitHub Releases, F-Droid) preenchem `AppItem.versions` com esta lista,
 * SEMPRE da mais recente para a mais antiga. A UI mostra a lista no detalhe e
 * deixa o utilizador escolher qual baixar.
 */
export interface AppVersion {
  /** Etiqueta da versão (tag do release, versionName…). */
  version: string;
  /** Plataforma do binário desta versão (deduzida da extensão na fonte). */
  platform: Platform;
  /** URL real do binário; null quando a versão não tem download direto. */
  downloadUrl: string | null;
  /** Nome do ficheiro com a extensão correta; null se indeterminável. */
  fileName: string | null;
  sizeBytes: number | null;
  /** Data de publicação (ISO), quando a fonte fornece. */
  publishedAt?: string;
  /** Notas da versão (release notes) em texto plano, quando houver. */
  notes?: string;
}

export interface AppItem {
  /** Formato `${source}:${idOriginal}`, determinístico entre sincronizações. */
  id: string;
  name: string;
  description: string;
  /** URL do ícone; pode ser '' — a UI desenha um avatar com a inicial. */
  iconUrl: string;
  /** Derivado da FONTE (nunca inferido pela UI). */
  platform: Platform;
  source: SourceId;
  /** URL real do binário; null quando a fonte não fornece download direto. */
  downloadUrl: string | null;
  /** Página oficial/da loja usada como fallback do download. */
  fallbackUrl: string | null;
  /** Repositório oficial (GitHub) do app, quando conhecido — alimenta “Ver no GitHub”. */
  repoUrl?: string | null;
  /** Nome do ficheiro com a extensão correta; null se indeterminável. */
  fileName: string | null;
  sizeBytes: number | null;
  /** Versão mais recente (reflete `versions[0]` quando existir). */
  version?: string;
  /**
   * TODAS as versões conhecidas, da mais recente para a mais antiga (cap por
   * fonte). Ausente ou vazia = a fonte expõe apenas a versão atual.
   */
  versions?: AppVersion[];
  developer?: string;
  /** 0 = gratuito. */
  price?: number;
  tags: string[];
  /** Timestamp ISO da coleta (base da sincronização automática de 24 h). */
  fetchedAt: string;
}
