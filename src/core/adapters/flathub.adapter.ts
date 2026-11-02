import type { AppItem } from '../models/AppItem';
import type { SourceAdapter } from './SourceAdapter';
import { mapLimit, nomeArquivoDeUrl, nowIso, stripHtml, truncate, urlRepoGitHub } from '../util';

const APPSTREAM_LISTA_URL = 'https://flathub.org/api/v2/appstream';
const APPSTREAM_DETALHE_URL = 'https://flathub.org/api/v2/appstream';
const FLATPAKREF_BASE = 'https://dl.flathub.org/repo/appstream';

interface FlathubDetalhe {
  id?: string;
  name?: string;
  summary?: string;
  description?: string;
  developer_name?: string;
  icon?: string | null;
  releases?: Array<{ version?: string }>;
  urls?: { homepage?: string | null };
  categories?: Array<{ name?: string } | string>;
}

/** Quantos apps são enriquecidos (detalhe individual) a cada sincronização. */
const DETALHES_POR_SINCRONIZACAO = 150;
const CONCORRENCIA_DETALHES = 6;

function nomeDeId(id: string): string {
  const ultimo = id.split('.').pop() ?? id;
  return ultimo.replace(/[-_]/g, ' ') || id;
}

function categoriaTag(c: { name?: string } | string): string {
  return (typeof c === 'string' ? c : c.name ?? '').toLowerCase();
}

/**
 * Adaptador do Flathub (Linux → aba Desktop), conforme o documento:
 * 1. `GET /api/v2/appstream` devolve a lista completa de IDs (barato);
 * 2. o enriquecimento é INCREMENTAL: a cada sincronização buscamos os detalhes
 *    de um lote rotativo de apps (`/api/v2/appstream/{id}`), para não martelar
 *    a API com milhares de chamadas. O upsert do cache preserva os lotes já
 *    enriquecidos das sincronizações anteriores.
 *
 * Download direto: o Flathub publica o `.flatpakref` instalável em
 * `https://dl.flathub.org/repo/appstream/{id}.flatpakref` (verificado).
 */
export class FlathubAdapter implements SourceAdapter {
  readonly source = 'flathub' as const;
  readonly platform = 'desktop' as const; // Linux

  async fetchAll(): Promise<AppItem[]> {
    const res = await fetch(APPSTREAM_LISTA_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Lista do Flathub respondeu ${res.status}`);
    const ids = (await res.json()) as string[];
    if (!Array.isArray(ids)) throw new Error('Lista do Flathub veio num formato inesperado');

    const agora = nowIso();

    // Lote rotativo por dia: com o tempo, todo o catálogo passa pelos detalhes.
    const dia = Math.floor(Date.now() / 86_400_000);
    const offset = ids.length > 0 ? (dia * DETALHES_POR_SINCRONIZACAO) % ids.length : 0;
    const lote: string[] = [];
    for (let i = 0; i < Math.min(DETALHES_POR_SINCRONIZACAO, ids.length); i++) {
      lote.push(ids[(offset + i) % ids.length]!);
    }

    const detalhes = new Map<string, FlathubDetalhe>();
    await mapLimit(lote, CONCORRENCIA_DETALHES, async (id) => {
      try {
        const r = await fetch(`${APPSTREAM_DETALHE_URL}/${encodeURIComponent(id)}`, {
          headers: { Accept: 'application/json' },
        });
        if (r.ok) detalhes.set(id, (await r.json()) as FlathubDetalhe);
      } catch {
        // sem detalhe, o item entra “seco” — a próxima sincronização tenta de novo
      }
    });

    return ids.map((id): AppItem => {
      const d = detalhes.get(id);
      const resumo = d?.summary ? stripHtml(d.summary) : '';
      const descricaoLonga = d?.description ? truncate(stripHtml(d.description)) : '';
      return {
        id: `flathub:${id}`,
        name: d?.name ?? nomeDeId(id),
        description: [resumo, descricaoLonga].filter(Boolean).join('\n\n'),
        iconUrl: d?.icon ?? '',
        platform: 'desktop',
        source: 'flathub',
        downloadUrl: `${FLATPAKREF_BASE}/${id}.flatpakref`,
        fallbackUrl: `https://flathub.org/apps/${id}`,
        repoUrl: urlRepoGitHub(d?.urls?.homepage ?? null),
        fileName: `${id}.flatpakref`,
        sizeBytes: null,
        version: d?.releases?.[0]?.version,
        developer: d?.developer_name,
        price: 0,
        tags: ['linux', 'flatpak', ...(d?.categories ?? []).map(categoriaTag).filter(Boolean)].slice(0, 5),
        fetchedAt: agora,
      };
    });
  }
}

/** Exportado para testes: confirma que o flatpakref tem um nome de ficheiro válido. */
export function nomeArquivoFlatpakref(id: string): string | null {
  return nomeArquivoDeUrl(`${FLATPAKREF_BASE}/${id}.flatpakref`);
}
