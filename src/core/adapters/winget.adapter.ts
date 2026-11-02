import type { AppItem } from '../models/AppItem';
import type { SourceAdapter } from './SourceAdapter';
import { nowIso, uniqueBy } from '../util';

const BASE_PADRAO = 'https://winget-pkg-api.onrender.com/api/v1';

/** A API comunitária devolve objetos soltos; lemos campos com nomes variáveis. */
type WingetPacote = Record<string, unknown>;

export interface WingetAdapterOptions {
  baseUrl?: string;
  /** Chave da API comunitária (header X-API-Key). Ver .env.example. */
  apiKey?: string;
  maxPacotes?: number;
  /** Consultas de busca (a API não expõe listagem completa). */
  queries?: string[];
}

function texto(pacote: WingetPacote, chaves: string[]): string | undefined {
  for (const k of chaves) {
    const v = pacote[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return undefined;
}

/** Página oficial do manifest do pacote no repositário microsoft/winget-pkgs. */
export function urlManifest(pkgId: string): string {
  const inicial = pkgId.charAt(0).toLowerCase();
  const caminho = pkgId
    .split('.')
    .map((parte) => encodeURIComponent(parte))
    .join('/');
  return `https://github.com/microsoft/winget-pkgs/tree/master/manifests/${inicial}/${caminho}`;
}

/**
 * Adaptador da API comunitária do Winget (NÃO oficial; base
 * https://winget-pkg-api.onrender.com/api/v1). O documento avisa: o serviço é
 * instável e limitado a ~20 req/s, e exige a header `X-API-Key`.
 *
 * Como a API só expõe busca (sem listagem completa), varremos um conjunto de
 * termos amplos. Falhas são toleradas pelo SyncOrchestrator (o cache anterior
 * é mantido). Em produção, prefira consumir os manifests JSON de
 * microsoft/winget-pkgs diretamente.
 */
export class WingetAdapter implements SourceAdapter {
  readonly source = 'winget' as const;
  readonly platform = 'desktop' as const; // Windows

  private readonly base: string;
  private readonly apiKey?: string;
  private readonly maxPacotes: number;
  private readonly queries: string[];

  constructor(options: WingetAdapterOptions = {}) {
    this.base = (options.baseUrl ?? BASE_PADRAO).replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.maxPacotes = options.maxPacotes ?? 400;
    this.queries = options.queries ?? [
      'browser',
      'editor',
      'media player',
      'office',
      'messaging',
      'archive',
      'terminal',
      'vpn',
      'pdf',
      'backup',
    ];
  }

  async fetchAll(): Promise<AppItem[]> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    const agora = nowIso();
    const achados: WingetPacote[] = [];

    for (const termo of this.queries) {
      if (achados.length >= this.maxPacotes) break;
      try {
        const res = await fetch(`${this.base}/search?q=${encodeURIComponent(termo)}`, { headers });
        if (!res.ok) throw new Error(`Winget API respondeu ${res.status}`);
        const dados = (await res.json()) as WingetPacote[] | { results?: WingetPacote[] } | WingetPacote;
        let lista: WingetPacote[] = [];
        if (Array.isArray(dados)) lista = dados;
        else if (Array.isArray((dados as { results?: WingetPacote[] }).results)) {
          lista = (dados as { results: WingetPacote[] }).results;
        }
        achados.push(...lista.slice(0, Math.ceil(this.maxPacotes / this.queries.length)));
      } catch {
        continue; // termo falhou; tentamos o próximo
      }
    }

    const itens = achados.map((pkg): AppItem | null => {
      const pkgId =
        texto(pkg, ['PackageIdentifier', 'packageIdentifier', 'Id', 'id', '_id']) ?? undefined;
      if (!pkgId) return null;
      const nome = texto(pkg, ['Name', 'name', 'PackageName', 'packageName']) ?? pkgId;
      const versao = texto(pkg, ['LatestVersion', 'latestVersion', 'Version', 'version']);
      return {
        id: `winget:${pkgId}`,
        name: nome,
        description: texto(pkg, ['Description', 'description', 'ShortDescription']) ?? '',
        iconUrl: '',
        platform: 'desktop',
        source: 'winget',
        // Installers vivem nos manifests; sem URL garantida, o botão é “Abrir na loja”.
        downloadUrl: null,
        fallbackUrl: urlManifest(pkgId),
        fileName: null,
        sizeBytes: null,
        version: versao,
        developer: texto(pkg, ['Publisher', 'publisher', 'Author', 'author']),
        price: 0,
        tags: ['windows'],
        fetchedAt: agora,
      };
    });

    return uniqueBy(itens.filter((i): i is AppItem => i !== null), (i) => i.id);
  }
}
