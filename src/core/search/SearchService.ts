import type { AppItem, SourceId } from '../models/AppItem';
import type { AppCache } from '../../data/cache';
import { normalizar } from '../util';

/**
 * Busca do catálogo, 100% local sobre o cache — a regra do documento:
 * a busca NUNCA dispara sincronização nem fala com APIs externas.
 *
 * Melhorias face a um `includes` simples:
 * - insensível a acentos e maiúsculas (“codigo” acha “Código”);
 * - por palavras: TODAS as palavras do termo têm de casar (ordem livre);
 * - ranqueado: nome > id > developer > tags > descrição;
 * - pesquisa em TODAS as plataformas (a UI agrupa por aba).
 */

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Campos {
  nome: string;
  id: string;
  dev: string;
  tags: string;
  desc: string;
}

const CAMPOS_CACHE = new WeakMap<AppItem, Campos>();

function camposDe(app: AppItem): Campos {
  let c = CAMPOS_CACHE.get(app);
  if (!c) {
    c = {
      nome: normalizar(app.name),
      id: normalizar(app.id),
      dev: normalizar(app.developer ?? ''),
      tags: normalizar(app.tags.join(' ')),
      desc: normalizar(app.description).slice(0, 800),
    };
    CAMPOS_CACHE.set(app, c);
  }
  return c;
}

/** Pontua um app para os tokens; 0 = não casa (todos os tokens têm de casar). */
function pontuar(app: AppItem, tokens: string[]): number {
  const c = camposDe(app);
  let total = 0;
  for (const tk of tokens) {
    let melhor = 0;
    if (c.nome === tk) melhor = 120;
    else if (c.nome.startsWith(tk)) melhor = 100;
    else if (new RegExp(`\\b${escaparRegex(tk)}`).test(c.nome)) melhor = 85;
    else if (c.nome.includes(tk)) melhor = 70;
    if (c.id.includes(tk)) melhor = Math.max(melhor, 50);
    if (c.dev && c.dev.includes(tk)) melhor = Math.max(melhor, 45);
    if (c.tags.includes(tk)) melhor = Math.max(melhor, 40);
    if (c.desc.includes(tk)) melhor = Math.max(melhor, 20);
    if (melhor === 0) return 0;
    total += melhor;
  }
  return total;
}

/** Busca ranqueada sobre uma lista já em memória. Sem termo, devolve a lista. */
export function buscarLocal(itens: AppItem[], termo: string): AppItem[] {
  const tokens = normalizar(termo).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...itens];
  const pontuados: Array<{ app: AppItem; pontos: number }> = [];
  for (const app of itens) {
    const pontos = pontuar(app, tokens);
    if (pontos > 0) pontuados.push({ app, pontos });
  }
  pontuados.sort((a, b) => b.pontos - a.pontos || a.app.name.localeCompare(b.app.name, 'pt'));
  return pontuados.map((p) => p.app);
}

/**
 * Serviço de busca da UI: leitura local do cache + opção EXPLÍCITA de buscar
 * no GitHub (clique do utilizador). Os resultados remotos são normalizados,
 * gravados no cache e relidos daí — a UI continua a consumir só o cache.
 */

/** Contrato estrutural mínimo do que o SearchService precisa do adaptador. */
export interface BuscadorRemoto {
  search(termo: string, maxRepos?: number): Promise<AppItem[]>;
}

export class SearchService {
  constructor(
    private cache: AppCache,
    private remoto: BuscadorRemoto | null,
  ) {}

  /** true quando existe um adaptador com busca remota. */
  get podeBuscarNoGitHub(): boolean {
    return this.remoto !== null;
  }

  /** Todos os itens do cache (para a busca entre plataformas). */
  async tudo(): Promise<AppItem[]> {
    return this.cache.getAll();
  }

  /**
   * Busca remota sob demanda: devolve quantos itens novos entraram no cache.
   * `tocarMeta: false` para não marcar o GitHub como recém-sincronizado.
   */
  async buscarNoGitHub(termo: string): Promise<number> {
    if (!this.remoto) return 0;
    const itens = await this.remoto.search(termo);
    await this.cache.upsertMany('github' satisfies SourceId, itens, { tocarMeta: false });
    return itens.length;
  }
}
