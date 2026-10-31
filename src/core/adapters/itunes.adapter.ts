import type { AppItem } from '../models/AppItem';
import type { SourceAdapter } from './SourceAdapter';
import { nowIso, stripHtml, uniqueBy } from '../util';

const SEARCH_URL = 'https://itunes.apple.com/search';

interface ITunesResultado {
  trackId: number;
  trackName: string;
  description?: string;
  artistName?: string;
  trackViewUrl?: string;
  artworkUrl512?: string;
  artworkUrl100?: string;
  version?: string;
  fileSizeBytes?: string;
  price?: number;
  formattedPrice?: string;
  genres?: string[];
}

export interface ITunesAdapterOptions {
  /** Termos de busca usados para varrer a App Store. */
  terms?: string[];
  country?: string;
  limitPerTerm?: number;
}

const TERMOS_PADRAO = [
  'weather',
  'notes',
  'calendar',
  'music',
  'podcast',
  'photo editor',
  'password manager',
  'news',
  'fitness',
  'language learning',
  'calculator',
  'offline maps',
];

function gratuito(r: ITunesResultado): boolean {
  if (typeof r.price === 'number') return r.price === 0;
  const fp = (r.formattedPrice ?? 'Free').toLowerCase();
  return fp === 'free' || fp === 'grátis' || fp === 'grátis';
}

/**
 * Adaptador da API pública do iTunes Search (apenas apps iOS gratuitos:
 * `price=0` + `entity=software`). A Apple NÃO fornece binários — por definição
 * do contrato, `downloadUrl` é sempre null e o botão nasce em modo
 * “Abrir na loja” com `fallbackUrl = trackViewUrl`.
 */
export class ITunesAdapter implements SourceAdapter {
  readonly source = 'itunes' as const;
  readonly platform = 'ios' as const;

  private readonly termos: string[];
  private readonly country: string;
  private readonly limite: number;

  constructor(options: ITunesAdapterOptions = {}) {
    this.termos = options.terms ?? TERMOS_PADRAO;
    this.country = options.country ?? 'US';
    this.limite = options.limitPerTerm ?? 40;
  }

  async fetchAll(): Promise<AppItem[]> {
    const resultados: ITunesResultado[] = [];
    for (const termo of this.termos) {
      try {
        const url =
          `${SEARCH_URL}?term=${encodeURIComponent(termo)}&country=${this.country}` +
          `&media=software&entity=software&price=0&limit=${this.limite}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) continue;
        const dados = (await res.json()) as { results?: ITunesResultado[] };
        resultados.push(...(dados.results ?? []));
      } catch {
        continue;
      }
    }

    const agora = nowIso();
    const itens = resultados.filter(gratuito).map(
      (r): AppItem => ({
        id: `itunes:${r.trackId}`,
        name: r.trackName,
        description: stripHtml(r.description ?? ''),
        iconUrl: r.artworkUrl512 ?? r.artworkUrl100?.replace(/100x100bb\.jpg$/, '512x512bb.jpg') ?? '',
        platform: 'ios',
        source: 'itunes',
        downloadUrl: null, // Apple não disponibiliza o binário
        fallbackUrl: r.trackViewUrl ?? null,
        fileName: null,
        sizeBytes: r.fileSizeBytes ? Number(r.fileSizeBytes) : null,
        version: r.version,
        developer: r.artistName,
        price: 0,
        tags: (r.genres ?? []).slice(0, 4),
        fetchedAt: agora,
      }),
    );
    return uniqueBy(itens, (i) => i.id);
  }
}
