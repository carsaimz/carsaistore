import type { AppItem, Platform } from '../models/AppItem';
import type { SourceAdapter } from './SourceAdapter';
import { limparMarkdown, nowIso, stripHtml, truncate, uniqueBy } from '../util';

/** Extensões que caracterizam um binário instalável de aplicação. */
export const APP_EXTENSIONS = [
  '.apk',
  '.aab',
  '.ipa',
  '.dmg',
  '.pkg',
  '.exe',
  '.msi',
  '.msix',
  '.appimage',
  '.deb',
  '.rpm',
] as const;

export function isApplicationAsset(assetName: string): boolean {
  const lower = assetName.toLowerCase();
  return APP_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function platformFromExtension(fileName: string): Platform | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.apk') || lower.endsWith('.aab')) return 'android';
  if (lower.endsWith('.ipa')) return 'ios';
  return 'desktop';
}

interface GhRepo {
  full_name: string;
  description: string | null;
  owner: { login: string };
  html_url: string;
  topics?: string[];
}

interface GhAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface GhRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  assets: GhAsset[];
}

export interface GitHubAdapterOptions {
  /** Consultas da Search API usadas para descobrir repositórios. */
  queries?: string[];
  /** Máximo de repositórios visitados por sincronização (protege os 60 req/h sem token). */
  maxRepos?: number;
  perPage?: number;
  releasesPerRepo?: number;
  /** Token OPCIONAL (5.000 req/h). Nunca vem embutido no código — ver .env.example. */
  token?: string;
}

const DEFAULT_QUERIES = [
  'topic:android stars:>200',
  'topic:electron stars:>300',
  'topic:flutter stars:>800',
  'topic:macos stars:>500',
];

/** Regex de `owner/repo`, usado pela busca remota para acertar repositórios diretos. */
const REGEX_OWNER_REPO = /^[\w.-]+\/[\w.-]+$/;

/**
 * Adaptador do GitHub: descobre repositórios via Search API e converte os
 * assets das releases em `AppItem`. Regras do documento técnico:
 * - release sem nenhum asset com extensão de app → ignorada;
 * - cada asset vira um item (plataforma deduzida da extensão);
 * - limite não autenticado é 60 req/h → descoberta enxuta + cache agressivo.
 */
export class GitHubAdapter implements SourceAdapter {
  readonly source = 'github' as const;
  /** Âncora do adaptador; a plataforma real de cada item vem da extensão. */
  readonly platform = 'desktop' as const;

  private readonly queries: string[];
  private readonly maxRepos: number;
  private readonly perPage: number;
  private readonly releasesPerRepo: number;
  private readonly token?: string;

  constructor(options: GitHubAdapterOptions = {}) {
    this.queries = options.queries ?? DEFAULT_QUERIES;
    this.maxRepos = options.maxRepos ?? 40;
    this.perPage = options.perPage ?? 30;
    this.releasesPerRepo = options.releasesPerRepo ?? 3;
    this.token = options.token;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async fetchAll(): Promise<AppItem[]> {
    const repos = await this.descobrirRepos();
    const itens: AppItem[] = [];
    const agora = nowIso();

    for (const repo of repos) {
      try {
        const releases = await this.releasesDe(repo.full_name);
        itens.push(...this.itensDeRepo(repo, releases, agora));
      } catch {
        continue; // rate limit/erro neste repo não derruba a fonte
      }
    }

    return itens;
  }

  /**
   * Busca remota sob demanda (ação explícita do utilizador na UI, nunca no
   * caminho crítico). Aceita um termo livre ou `owner/repo` exato. Repos sem
   * releases com binários entram como item de catálogo com link do repo
   * (modo “Abrir na loja”), para não sumirem da busca.
   */
  async search(termo: string, maxRepos = 6): Promise<AppItem[]> {
    const limpo = termo.trim();
    if (!limpo) return [];
    const repos = REGEX_OWNER_REPO.test(limpo)
      ? await this.repoExato(limpo).then((r) => (r ? [r] : []))
      : await this.pesquisarRepos(limpo, maxRepos);

    const itens: AppItem[] = [];
    const agora = nowIso();
    for (const repo of repos) {
      try {
        const releases = await this.releasesDe(repo.full_name);
        itens.push(...this.itensDeRepo(repo, releases, agora));
      } catch {
        continue;
      }
    }
    return itens;
  }

  // ===== helpers partilhados =====

  private async releasesDe(fullName: string): Promise<GhRelease[]> {
    const res = await fetch(
      `https://api.github.com/repos/${fullName}/releases?per_page=${this.releasesPerRepo}`,
      { headers: this.headers },
    );
    if (!res.ok) return [];
    return (await res.json()) as GhRelease[];
  }

  private async repoExato(fullName: string): Promise<GhRepo | null> {
    const res = await fetch(`https://api.github.com/repos/${fullName}`, { headers: this.headers });
    if (!res.ok) return null;
    return (await res.json()) as GhRepo;
  }

  private async pesquisarRepos(termo: string, maxRepos: number): Promise<GhRepo[]> {
    const url =
      `https://api.github.com/search/repositories?q=${encodeURIComponent(termo)}` +
      `&sort=stars&order=desc&per_page=${Math.min(30, maxRepos * 2)}`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) {
      throw new Error(`GitHub Search falhou com ${res.status} (limite da API atingido?)`);
    }
    const dados = (await res.json()) as { items?: GhRepo[] };
    return (dados.items ?? []).slice(0, maxRepos);
  }

  /**
   * Converte um repo + releases em itens. Com assets de app → um item por
   * asset (comportamento do fetchAll). Sem nenhum asset de app → um único
   * item do repo, sem download direto, com `repoUrl` preenchido.
   */
  private itensDeRepo(repo: GhRepo, releases: GhRelease[], agora: string): AppItem[] {
    const itens: AppItem[] = [];
    for (const release of releases) {
      if (release.draft) continue;
      const assets = (release.assets ?? []).filter((a) => isApplicationAsset(a.name));
      if (assets.length === 0) continue;
      for (const asset of assets) {
        const base = `${repo.full_name}@${release.tag_name}`;
        itens.push({
          // Com vários assets, acrescentamos o nome do asset para manter o id único.
          id: `github:${assets.length > 1 ? `${base}:${asset.name}` : base}`,
          name: repo.full_name.split('/')[1] ?? repo.full_name,
          description: truncate(
            limparMarkdown(release.body ?? '') ||
              stripHtml(release.name ?? repo.description ?? ''),
          ),
          iconUrl: `https://github.com/${repo.owner.login}.png`,
          platform: platformFromExtension(asset.name) ?? 'desktop',
          source: 'github',
          downloadUrl: asset.browser_download_url,
          fallbackUrl: release.html_url || repo.html_url,
          repoUrl: repo.html_url,
          fileName: asset.name,
          sizeBytes: asset.size,
          version: release.tag_name,
          developer: repo.owner.login,
          price: 0,
          tags: (repo.topics ?? []).slice(0, 5),
          fetchedAt: agora,
        });
      }
    }

    // Nenhum binário em todo o repo → item de catálogo só com link.
    if (itens.length === 0) {
      const tag = releases.find((r) => !r.draft)?.tag_name;
      itens.push({
        id: `github:${repo.full_name}`,
        name: repo.full_name.split('/')[1] ?? repo.full_name,
        description: truncate(stripHtml(repo.description ?? '')),
        iconUrl: `https://github.com/${repo.owner.login}.png`,
        platform: this.platform,
        source: 'github',
        downloadUrl: null,
        fallbackUrl: repo.html_url,
        repoUrl: repo.html_url,
        fileName: null,
        sizeBytes: null,
        version: tag,
        developer: repo.owner.login,
        price: 0,
        tags: (repo.topics ?? []).slice(0, 5),
        fetchedAt: agora,
      });
    }
    return itens;
  }

  private async descobrirRepos(): Promise<GhRepo[]> {
    const achados: GhRepo[] = [];
    for (const q of this.queries) {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${this.perPage}`;
      const res = await fetch(url, { headers: this.headers });
      if (!res.ok) {
        throw new Error(`GitHub Search falhou com ${res.status} (limite de 60 req/h sem token?)`);
      }
      const dados = (await res.json()) as { items?: GhRepo[] };
      achados.push(...(dados.items ?? []));
    }
    return uniqueBy(achados, (r) => r.full_name).slice(0, this.maxRepos);
  }
}
