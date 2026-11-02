import type { AppItem } from '../models/AppItem';
import type { SourceAdapter } from './SourceAdapter';
import { nowIso, stripHtml } from '../util';

const INDEX_URL = 'https://f-droid.org/repo/index-v2.json';
const REPO_BASE = 'https://f-droid.org/repo';
const ICON_BASE = `${REPO_BASE}/icons-640`;

type Localizado = Record<string, string>;

interface FdroidVersao {
  file?: { name?: string; size?: number };
  manifest?: { versionName?: string };
  size?: number;
}

interface FdroidPacote {
  metadata?: {
    name?: Localizado;
    summary?: Localizado;
    description?: Localizado;
    authorName?: string;
    maintainerName?: string;
    icon?: Localizado | string;
  };
  versions?: Record<string, FdroidVersao>;
}

interface FdroidIndice {
  packages?: Record<string, FdroidPacote>;
}

/** Prefere “en”; cai no primeiro idioma disponível. */
function localizar(mapa: Localizado | string | undefined, fallback = ''): string {
  if (!mapa) return fallback;
  if (typeof mapa === 'string') return mapa;
  return mapa.en ?? Object.values(mapa)[0] ?? fallback;
}

/**
 * Adaptador do índice oficial do F-Droid (index-v2.json).
 *
 * O ficheiro tem dezenas de MB: é coletado UMA vez por sincronização e
 * convertido inteiro em memória. Em aparelhos muito limitados, ligue aqui um
 * parser de JSON em streaming — o contrato do adaptador não muda.
 */
export class FdroidAdapter implements SourceAdapter {
  readonly source = 'fdroid' as const;
  readonly platform = 'android' as const;

  async fetchAll(): Promise<AppItem[]> {
    const res = await fetch(INDEX_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Índice do F-Droid respondeu ${res.status}`);
    const indice = (await res.json()) as FdroidIndice;
    const agora = nowIso();
    const itens: AppItem[] = [];

    for (const [packageName, pacote] of Object.entries(indice.packages ?? {})) {
      const meta = pacote.metadata ?? {};
      // Última versão = maior versionCode.
      const versoes = Object.entries(pacote.versions ?? {})
        .map(([codigo, v]) => ({ codigo, numero: Number.parseInt(codigo, 10) || 0, v }))
        .sort((a, b) => b.numero - a.numero);
      const ultima = versoes[0];
      // O index-v2 guarda nomes de ficheiro com “/” inicial — normalizamos para
      // não gerar URLs com barra dupla.
      const limpar = (caminho: string): string => caminho.replace(/^\/+/, '');
      const nomeArquivo = ultima
        ? limpar(ultima.v.file?.name ?? `${packageName}_${ultima.codigo}.apk`)
        : null;
      const iconArquivo = localizar(meta.icon);
      const resumo = stripHtml(localizar(meta.summary));
      const descricao = stripHtml(localizar(meta.description));

      itens.push({
        id: `fdroid:${packageName}`,
        name: localizar(meta.name, packageName),
        description: [resumo, descricao].filter(Boolean).join('\n\n'),
        iconUrl: iconArquivo ? `${ICON_BASE}/${iconArquivo}` : '',
        platform: 'android',
        source: 'fdroid',
        downloadUrl: nomeArquivo ? `${REPO_BASE}/${nomeArquivo}` : null,
        fallbackUrl: `https://f-droid.org/packages/${packageName}/`,
        fileName: nomeArquivo,
        sizeBytes: ultima?.v.size ?? ultima?.v.file?.size ?? null,
        version: ultima?.v.manifest?.versionName,
        developer: meta.authorName ?? meta.maintainerName ?? 'F-Droid',
        price: 0,
        tags: ['f-droid'],
        fetchedAt: agora,
      });
    }

    return itens;
  }
}
