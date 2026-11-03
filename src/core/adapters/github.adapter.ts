import type { AppItem, AppVersion, Platform } from '../models/AppItem';
import type { SourceAdapter } from './SourceAdapter';
import { limparMarkdown, mapLimit, nowIso, stripHtml, truncate, uniqueBy } from '../util';

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

/**
 * Prioridade de instalação dentro de um mesmo release: o formato instalável
 * direto (.apk/.dmg/…) vem antes do formato de loja (.aab precisa da Play
 * Store). Decide qual binário representa a versão no catálogo.
 */
const PRIORIDADE_EXT = [
  '.apk',
  '.ipa',
  '.appimage',
  '.exe',
  '.msi',
  '.msix',
  '.dmg',
  '.pkg',
  '.deb',
  '.rpm',
  '.aab',
];

function ordemDeInstalacao(nome: string): number {
  const lower = nome.toLowerCase();
  const i = PRIORIDADE_EXT.findIndex((ext) => lower.endsWith(ext));
  return i === -1 ? PRIORIDADE_EXT.length : i;
}

/** Estado persistente do adaptador (pool/cursor) — fornecido pelo cache. */
export interface EstadoAdaptador {
  get(chave: string): Promise<string | null>;
  set(chave: string, valor: string): Promise<void>;
}

/** Estado em memória: fallback para testes/ambientes sem cache. */
export function estadoEmMemoria(): EstadoAdaptador {
  const valores = new Map<string, string>();
  return {
    async get(chave) {
      return valores.get(chave) ?? null;
    },
    async set(chave, valor) {
      valores.set(chave, valor);
    },
  };
}

interface GhRepo {
  full_name: string;
  name?: string;
  stargazers_count?: number;
  description: string | null;
  language?: string | null;
  owner: { login: string };
  html_url: string;
  topics?: string[];
}

/** Repositório simplificado devolvido pela Search API. */
interface RepoDescoberto {
  full_name: string;
  name?: string;
  stargazers_count?: number;
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
  published_at?: string | null;
  assets: GhAsset[];
}

export interface GitHubAdapterOptions {
  /** Consultas da Search API usadas para descobrir repositórios (rotativas). */
  queries?: string[];
  /** Repositórios com binários verificados — visitados primeiro, sempre. */
  seed?: string[];
  /** Máximo de repositórios visitados por sincronização (protege os limites). */
  maxReposPorSync?: number;
  /** Tamanho do pool de repos guardado entre sincronizações. */
  poolMax?: number;
  perPage?: number;
  releasesPerRepo?: number;
  /** Token OPCIONAL (5.000 req/h). Nunca vem embutido no código — ver .env.example. */
  token?: string;
  /** Estado persistente (cursor/pool). Sem ele, roda tudo em memória. */
  estado?: EstadoAdaptador;
}

/**
 * Consultas de descoberta, por ordem de qualidade: `topic:fdroid` e
 * `topic:apk` quase garantem repositórios que publicam binários nas releases;
 * os temas genéricos trazem volume. A cada sincronização são usadas 2, em
 * rotação, para respeitar o limite da Search API (10 req/min sem token).
 */
const QUERIES_PADRAO = [
  'topic:fdroid stars:>5',
  'topic:apk stars:>20',
  'topic:android stars:>200',
  'topic:flutter stars:>800',
  'topic:electron stars:>300',
  'topic:macos stars:>500',
];

/**
 * Repos com binários confirmados nas releases (visitados em toda rotação do
 * pool, garantindo catálogo mínimo mesmo quando a Search API está limitada).
 */
const SEED_PADRAO = [
  // Android (APK nas releases)
  'TeamNewPipe/NewPipe',
  'AegisAuthenticator/Aegis',
  'LawnchairLauncher/lawnchair',
  'RikkaApps/Shizuku',
  'AuroraOSS/AuroraStore',
  'streetcomplete/StreetComplete',
  'AntennaPod/AntennaPod',
  'Jellyfin/jellyfin-android',
  'wireguard/wireguard-android',
  'wikimedia/apps-android-wikipedia',
  'TeamAmaze/AmazeFileManager',
  'thunderbird/thunderbird-android',
  'immich-app/immich',
  // Desktop
  'obsidianmd/obsidian-releases',
  'Minbrowser/Min',
  'lmms/lmms',
  'audacity/audacity',
  'element-hq/element-desktop',
];

/** Regex de `owner/repo`, usado pela busca remota para acertar repositórios diretos. */
const REGEX_OWNER_REPO = /^[\w.-]+\/[\w.-]+$/;

/** Plataforma “palpite” para repos sem binários, pela linguagem principal. */
function plataformaPorLinguagem(linguagem: string | null | undefined): Platform {
  switch ((linguagem ?? '').toLowerCase()) {
    case 'kotlin':
    case 'java':
    case 'dart':
      return 'android';
    case 'swift':
    case 'objective-c':
      return 'ios';
    default:
      return 'desktop';
  }
}

/** Erro interno de limite da API (403/429): para a coleta sem quebrar a fonte. */
export class LimiteAtingidoError extends Error {
  constructor() {
    super('Limite da API do GitHub atingido (403/429).');
    this.name = 'LimiteAtingidoError';
  }
}

/**
 * Adaptador do GitHub: descobre repositórios via Search API e converte os
 * assets das releases em `AppItem` AGRUPADO por app e plataforma:
 * - um repo com APKs vira UM item `github:owner/repo#android` com todas as
 *   versões em `versions` (mais recente primeiro);
 * - se o mesmo repo publica .dmg/.exe, também vira item `github:owner/repo#desktop`;
 * - release sem asset de app é ignorada; repo sem nenhum binário entra como
 *   item de catálogo com `repoUrl` (modo “Abrir na loja”).
 *
 * Limites: 60 req/h sem token → pool de repos persistido com cursor rotativo
 * (cada sincronização visita um pedaço novo do pool; com token, visita muito
 * mais). Falhas pontuais de rede/limite preservam o que já foi coletado.
 */
export class GitHubAdapter implements SourceAdapter {
  readonly source = 'github' as const;
  /** Âncora do adaptador; a plataforma real de cada item vem da extensão. */
  readonly platform = 'desktop' as const;

  private readonly queries: string[];
  private readonly seed: string[];
  private readonly maxReposPorSync: number;
  private readonly poolMax: number;
  private readonly perPage: number;
  private readonly releasesPerRepo: number;
  private readonly token?: string;
  private readonly estado: EstadoAdaptador;

  constructor(options: GitHubAdapterOptions = {}) {
    this.queries = options.queries ?? QUERIES_PADRAO;
    this.seed = options.seed ?? SEED_PADRAO;
    this.token = options.token;
    // Com token (5.000 req/h) podemos visitar muito mais repos por sync.
    this.maxReposPorSync = options.maxReposPorSync ?? (this.token ? 150 : 40);
    this.poolMax = options.poolMax ?? 400;
    this.perPage = options.perPage ?? 30;
    this.releasesPerRepo = options.releasesPerRepo ?? 10;
    this.estado = options.estado ?? estadoEmMemoria();
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async fetchAll(onPartial?: (lote: AppItem[]) => void | Promise<void>): Promise<AppItem[]> {
    const pool = await this.garantirPool();
    const cursor = await this.numero('github:cursor');
    const tamanho = Math.min(this.maxReposPorSync, pool.length);

    // Fatia rotativa do pool: a cada sincronização, repos diferentes.
    const fatia: string[] = [];
    for (let i = 0; i < tamanho; i++) fatia.push(pool[(cursor + i) % pool.length]!);
    if (pool.length > 0) {
      await this.estado.set('github:cursor', String((cursor + tamanho) % pool.length));
    }

    const itens: AppItem[] = [];
    let esgotado = false; // limite atingido: para a coleta, retoma no próximo sync
    await mapLimit(fatia, 3, async (fullName) => {
      if (esgotado) return;
      try {
        const releases = await this.releasesDe(fullName);
        const itensRepo = this.itensDeReleases({ full_name: fullName }, releases, {
          incluirSemBinarios: false,
        });
        if (itensRepo.length > 0) {
          itens.push(...itensRepo);
          await onPartial?.(itensRepo);
        }
      } catch (error) {
        if (error instanceof LimiteAtingidoError) esgotado = true;
        // outros erros: segue para o próximo repo
      }
    });

    return itens;
  }

  /**
   * Busca remota sob demanda (ação explícita do utilizador na UI, nunca no
   * caminho crítico). Estratégias em ordem:
   * 1. `owner/repo` exato → repo direto;
   * 2. termo livre → busca best-match (relevância, sem sort por estrelas) +
   *    busca restrita ao NOME (`termo in:name`), que acha repos pequenos e
   *    novos que a busca geral esconde atrás de repos homônimos maiores.
   * Repos sem releases com binários entram como item de catálogo com link do
   * repo (modo “Abrir na loja”), para não sumirem da busca.
   */
  async search(termo: string, maxRepos = 15): Promise<AppItem[]> {
    const limpo = termo.trim();
    if (!limpo) return [];

    // `owner/repo` exato: consulta direta (a Search API não resolve bem).
    if (REGEX_OWNER_REPO.test(limpo)) {
      const repo = await this.repoExato(limpo);
      if (!repo) return [];
      try {
        const releases = await this.releasesDe(repo.full_name);
        return this.itensDeReleases(repo, releases, { incluirSemBinarios: true });
      } catch {
        return [];
      }
    }

    // Termo livre: matches NO NOME primeiro (acha repos pequenos/novos que a
    // busca geral esconde atrás de homônimos maiores), depois best-match.
    const porNome = await this.pesquisarRepos(`${limpo} in:name`, maxRepos * 2).catch(() => [] as RepoDescoberto[]);
    const geral = await this.pesquisarRepos(limpo, maxRepos * 2).catch(() => [] as RepoDescoberto[]);
    const limpoMin = limpo.toLowerCase();
    const alvo = uniqueBy([...porNome, ...geral], (r) => r.full_name.toLowerCase())
      // Repos cujo NOME é exatamente o termo vêm primeiro (empate: estrelas);
      // é assim que “xcoder” acha um repo pequeno chamado “xcoder”.
      .sort(
        (a, b) =>
          Number((b.name ?? '').toLowerCase() === limpoMin) -
            Number((a.name ?? '').toLowerCase() === limpoMin) ||
          (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0),
      )
      .slice(0, maxRepos);

    const itens: AppItem[] = [];
    let esgotado = false;
    for (const repo of alvo) {
      if (esgotado) break;
      try {
        const releases = await this.releasesDe(repo.full_name);
        itens.push(...this.itensDeReleases({ full_name: repo.full_name }, releases, { incluirSemBinarios: true }));
      } catch (error) {
        if (error instanceof LimiteAtingidoError) esgotado = true;
      }
    }
    return itens;
  }

  // ===== pool de repositórios (estado persistente) =====

  /**
   * Garante o pool: começa pelo seed; a cada sincronização acrescenta 2
   * consultas de descoberta em rotação (respeitando a Search API) até o
   * limite `poolMax`. O cursor garante que cada sync visite um pedaço novo.
   */
  private async garantirPool(): Promise<string[]> {
    const CHAVE_POOL = 'github:pool';
    let pool: string[] = [];
    const salvo = await this.estado.get(CHAVE_POOL);
    if (salvo) {
      try {
        pool = JSON.parse(salvo) as string[];
      } catch {
        pool = [];
      }
    }

    if (pool.length < this.poolMax) {
      const qi = await this.numero('github:qi');
      const consultas = [this.queries[qi % this.queries.length]!, this.queries[(qi + 1) % this.queries.length]!];
      await this.estado.set('github:qi', String((qi + 2) % this.queries.length));
      for (const q of consultas) {
        try {
          const repos = await this.pesquisarRepos(q, this.perPage);
          pool.push(...repos.map((r) => r.full_name));
        } catch (error) {
          if (error instanceof LimiteAtingidoError) break; // segue com o pool atual
        }
      }
    }

    pool = uniqueBy([...this.seed, ...pool], (n) => n.toLowerCase()).slice(0, this.poolMax);
    await this.estado.set(CHAVE_POOL, JSON.stringify(pool));
    return pool;
  }

  private async numero(chave: string): Promise<number> {
    const valor = await this.estado.get(chave);
    const n = Number.parseInt(valor ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  /** Search API → repos simplificados. Sem `sort`: ordem de relevância. */
  private async pesquisarRepos(consulta: string, perPage: number): Promise<RepoDescoberto[]> {
    const url =
      `https://api.github.com/search/repositories?q=${encodeURIComponent(consulta)}` +
      `&per_page=${Math.min(50, perPage)}`;
    const res = await fetch(url, { headers: this.headers });
    if (res.status === 403 || res.status === 429) throw new LimiteAtingidoError();
    if (!res.ok) return [];
    const dados = (await res.json()) as { items?: GhRepo[] };
    return (dados.items ?? []).map((r) => ({
      full_name: r.full_name,
      name: r.name,
      stargazers_count: r.stargazers_count,
    }));
  }

  private async releasesDe(fullName: string): Promise<GhRelease[]> {
    const res = await fetch(
      `https://api.github.com/repos/${fullName}/releases?per_page=${this.releasesPerRepo}`,
      { headers: this.headers },
    );
    if (res.status === 403 || res.status === 429) throw new LimiteAtingidoError();
    if (!res.ok) return [];
    return (await res.json()) as GhRelease[];
  }

  private async repoExato(fullName: string): Promise<GhRepo | null> {
    const res = await fetch(`https://api.github.com/repos/${fullName}`, { headers: this.headers });
    if (res.status === 403 || res.status === 429) throw new LimiteAtingidoError();
    if (!res.ok) return null;
    return (await res.json()) as GhRepo;
  }

  // ===== conversão repo+releases → itens agrupados =====

  /**
   * Converte as releases de um repo em itens. Com assets de app → um item por
   * plataforma presente, cada um com a lista completa de versões. Sem nenhum
   * asset de app → um único item do repo, sem download direto, com `repoUrl`.
   */
  private itensDeReleases(
    repo: {
      full_name: string;
      description?: string | null;
      language?: string | null;
      topics?: string[];
      owner?: { login: string };
    },
    releases: GhRelease[],
    options: { /** true (busca remota): repos sem binários entram como item só com link. */
      incluirSemBinarios: boolean },
  ): AppItem[] {
    const [owner, nome] = repo.full_name.split('/') as [string, string];
    const login = repo.owner?.login ?? owner;
    const agora = nowIso();

    // 1. Recolhe todas as versões baixáveis (releases vêm mais novas primeiro).
    const versoes: AppVersion[] = [];
    for (const release of releases) {
      if (release.draft) continue;
      const assets = (release.assets ?? [])
        .filter((a) => isApplicationAsset(a.name))
        // .apk antes de .aab no mesmo release: o principal é o instalável.
        .sort((a, b) => ordemDeInstalacao(a.name) - ordemDeInstalacao(b.name));
      for (const asset of assets) {
        versoes.push({
          version: release.tag_name,
          platform: platformFromExtension(asset.name) ?? 'desktop',
          downloadUrl: asset.browser_download_url,
          fileName: asset.name,
          sizeBytes: asset.size,
          publishedAt: release.published_at ?? undefined,
          notes: truncate(limparMarkdown(release.body ?? ''), 300) || undefined,
        });
      }
    }

    // 2. Sem binários: item de catálogo só com link — apenas na BUSCA remota,
    //    para o que o utilizador procurou não “sumir”; a descoberta automática
    //    ignora estes repos para não poluir o catálogo.
    if (versoes.length === 0) {
      if (!options.incluirSemBinarios) return [];
      const tag = releases.find((r) => !r.draft)?.tag_name;
      return [
        {
          id: `github:${repo.full_name}`,
          name: nome ?? repo.full_name,
          description: truncate(stripHtml(repo.description ?? '')) || 'Distribuído via GitHub.',
          iconUrl: `https://github.com/${login}.png`,
          platform: plataformaPorLinguagem(repo.language),
          source: 'github',
          downloadUrl: null,
          fallbackUrl: `https://github.com/${repo.full_name}`,
          repoUrl: `https://github.com/${repo.full_name}`,
          fileName: null,
          sizeBytes: null,
          version: tag,
          developer: login,
          price: 0,
          tags: (repo.topics ?? []).slice(0, 5),
          fetchedAt: agora,
        },
      ];
    }

    // 3. Agrupa por plataforma: um item por plataforma, com todas as versões.
    const grupos = new Map<Platform, AppVersion[]>();
    for (const v of versoes) {
      const lista = grupos.get(v.platform) ?? [];
      lista.push(v);
      grupos.set(v.platform, lista);
    }

    const itens: AppItem[] = [];
    for (const [plataforma, versoesDaPlataforma] of grupos) {
      const versoesLimitadas = versoesDaPlataforma.slice(0, 20);
      const primeira = versoesLimitadas[0]!;
      itens.push({
        id: `github:${repo.full_name}#${plataforma}`,
        name: nome ?? repo.full_name,
        description:
          truncate(stripHtml(repo.description ?? '')) ||
          primeira.notes ||
          'Aplicativo distribuído via GitHub Releases.',
        iconUrl: `https://github.com/${login}.png`,
        platform: plataforma,
        source: 'github',
        downloadUrl: primeira.downloadUrl,
        fallbackUrl: versoes[0]?.downloadUrl ?? `https://github.com/${repo.full_name}/releases`,
        repoUrl: `https://github.com/${repo.full_name}`,
        fileName: primeira.fileName,
        sizeBytes: primeira.sizeBytes,
        version: primeira.version,
        versions: versoesLimitadas,
        developer: login,
        price: 0,
        tags: (repo.topics ?? []).slice(0, 5),
        fetchedAt: agora,
      });
    }
    return itens;
  }
}
