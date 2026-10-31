import type { AppItem } from '../models/AppItem';
import type { SourceAdapter } from './SourceAdapter';
import { nomeArquivoDeUrl, nowIso } from '../util';

const CASKS_URL = 'https://formulae.brew.sh/api/cask.json';

interface BrewCask {
  token: string;
  name?: string | string[];
  desc?: string;
  homepage?: string;
  url?: string | Array<string | { url?: string }>;
  version?: string;
}

function extrairUrl(entry: string | { url?: string } | undefined): string | null {
  if (!entry) return null;
  return typeof entry === 'string' ? entry : entry.url ?? null;
}

/**
 * Adaptador do Homebrew Casks (macOS → aba Desktop). A API devolve a lista
 * completa de casks sem rate limit relevante.
 *
 * Regra do documento: se `cask.url` não permite inferir um nome de ficheiro
 * com extensão (caso de .zip/redirecionamentos sem pista), não oferecemos
 * download direto — o botão cai no modo “Abrir na loja” com a homepage.
 */
export class HomebrewAdapter implements SourceAdapter {
  readonly source = 'homebrew' as const;
  readonly platform = 'desktop' as const; // macOS

  async fetchAll(): Promise<AppItem[]> {
    const res = await fetch(CASKS_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Homebrew Casks respondeu ${res.status}`);
    const casks = (await res.json()) as BrewCask[];
    const agora = nowIso();

    return casks.map((cask): AppItem => {
      const url = Array.isArray(cask.url) ? extrairUrl(cask.url[0]) : cask.url ?? null;
      const nomeArquivo = url ? nomeArquivoDeUrl(url) : null;
      const nome = Array.isArray(cask.name) ? cask.name[0] : cask.name;
      return {
        id: `homebrew:${cask.token}`,
        name: nome ?? cask.token,
        description: cask.desc ?? '',
        iconUrl: '', // a API de casks não expõe ícones; a UI mostra avatar
        platform: 'desktop',
        source: 'homebrew',
        downloadUrl: url && nomeArquivo ? url : null,
        fallbackUrl: cask.homepage ?? null,
        fileName: url && nomeArquivo ? nomeArquivo : null,
        sizeBytes: null,
        version: cask.version,
        developer: undefined,
        price: 0,
        tags: ['macos'],
        fetchedAt: agora,
      };
    });
  }
}
