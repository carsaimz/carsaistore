import type { AppItem, Platform } from '../../core/models/AppItem';
import type { SourceAdapter } from '../../core/adapters/SourceAdapter';
import type { AppCache } from '../../data/cache';
import { SearchService, buscarLocal } from '../../core/search/SearchService';
import { syncAll, syncIfStale } from '../../core/sync/SyncOrchestrator';
import { PlatformTabs } from '../components/PlatformTabs';
import { createAppCard } from '../components/AppCard';
import { showToast } from '../components/Toast';
import { ROTULO_PLATAFORMA } from '../labels';

const PLATAFORMAS: Platform[] = ['android', 'ios', 'desktop'];
/** Paginação do grid: evita montar milhares de cards de uma vez. */
const LOTE_VISIVEL = 120;

/**
 * Página principal: abas Android | iOS | Desktop + busca + grid de cards.
 * Regras do documento: a UI só lê do cache; a busca NUNCA dispara sincronização.
 *
 * Busca: quando há termo, pesquisamos TODAS as plataformas (resultados
 * agrupados por aba) com ranking tolerante a acentos; se o catálogo local não
 * tem o que o utilizador procura, um botão explícito busca o termo no GitHub
 * e grava os resultados no cache.
 */
export class CatalogPage {
  private platform: Platform = 'android';
  private termo = '';
  private limiteVisivel = LOTE_VISIVEL;
  private syncing = false;
  private tabs: PlatformTabs;
  private busca: SearchService;

  private gridEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private syncBtn!: HTMLButtonElement;
  private campoBusca!: HTMLInputElement;

  private itensPlataforma: AppItem[] = [];
  private itensTodos: AppItem[] = [];

  constructor(
    private cache: AppCache,
    private adapters: SourceAdapter[],
  ) {
    this.tabs = new PlatformTabs((p) => {
      this.limparBusca();
      void this.setPlatform(p);
    });
    const github = this.adapters.find((a) => a.source === 'github');
    this.busca = new SearchService(
      cache,
      github && 'search' in github ? (github as unknown as GitHubLike) : null,
    );
  }

  async mount(root: HTMLElement): Promise<void> {
    root.replaceChildren();

    // Re-montagem (voltar do detalhe) começa limpa: sem busca ativa.
    this.termo = '';
    this.limiteVisivel = LOTE_VISIVEL;

    // Se a rota mudar enquanto esperamos o cache, não escrevemos na página nova.
    const minhaRota = window.location.hash || '#/';
    /** true se o utilizador navegou para outra página desde o início do mount. */
    const rotaMudou = (): boolean => (window.location.hash || '#/') !== minhaRota;

    // ===== Cabeçalho mínimo: marca + sincronizar (só o essencial) =====
    const header = document.createElement('header');
    header.className = 'topo';

    const marca = document.createElement('div');
    marca.className = 'topo__marca';
    const logo = document.createElement('span');
    logo.className = 'topo__logo';
    logo.setAttribute('aria-hidden', 'true');
    logo.textContent = 'C';
    const titulo = document.createElement('h1');
    titulo.textContent = 'Carsai Store';
    marca.append(logo, titulo);

    const acoes = document.createElement('div');
    acoes.className = 'topo__acoes';
    this.syncBtn = document.createElement('button');
    this.syncBtn.type = 'button';
    this.syncBtn.className = 'btn';
    this.syncBtn.textContent = 'Sincronizar';
    this.syncBtn.addEventListener('click', () => {
      void this.sincronizar();
    });
    acoes.appendChild(this.syncBtn);

    header.append(marca, acoes);

    // ===== Controles fixos no topo ao rolar (busca + abas) =====
    const controles = document.createElement('div');
    controles.className = 'controles';

    this.campoBusca = document.createElement('input');
    this.campoBusca.type = 'search';
    this.campoBusca.className = 'busca';
    this.campoBusca.placeholder = 'Buscar apps em todas as plataformas…';
    this.campoBusca.setAttribute('aria-label', 'Buscar aplicativos');
    this.campoBusca.autocomplete = 'off';
    this.campoBusca.spellcheck = false;
    let timer: number | undefined;
    this.campoBusca.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        this.termo = this.campoBusca.value.trim();
        this.limiteVisivel = LOTE_VISIVEL;
        this.renderGrid();
      }, 180);
    });
    this.campoBusca.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.limparBusca();
        this.renderGrid();
      }
    });

    const tabsEl = document.createElement('nav');
    tabsEl.className = 'tabs';
    this.tabs.mount(tabsEl);

    controles.append(this.campoBusca, tabsEl);

    // ===== Estado + grid =====
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'status';
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.textContent = 'A carregar o cache local…';
    this.gridEl = document.createElement('div');
    this.gridEl.className = 'grade';

    root.append(header, controles, this.statusEl, this.gridEl);

    await this.atualizar();
    if (rotaMudou()) return;

    // Primeira utilização: cache vazio → sincronização completa com feedback.
    const contagens = await Promise.all(PLATAFORMAS.map((p) => this.cache.countByPlatform(p)));
    const total = contagens.reduce((a, b) => a + b, 0);
    if (total === 0) {
      await this.sincronizar('A preparar o catálogo pela primeira vez —');
    } else {
      // Rotina de fundo: sincroniza se alguma fonte passou de 24 h (não bloqueia).
      void syncIfStale(this.adapters, this.cache)
        .then((rodou) => {
          if (rotaMudou()) return;
          if (rodou) {
            void this.atualizar();
            showToast('Catálogo atualizado automaticamente.');
          } else {
            this.statusEl.textContent = this.textoStatus();
          }
        })
        .catch(() => {
          if (!rotaMudou()) this.statusEl.textContent = this.textoStatus();
        });
    }
  }

  private async setPlatform(p: Platform): Promise<void> {
    this.platform = p;
    this.limiteVisivel = LOTE_VISIVEL;
    await this.atualizar();
  }

  private limparBusca(): void {
    this.termo = '';
    if (this.campoBusca) this.campoBusca.value = '';
    this.limiteVisivel = LOTE_VISIVEL;
  }

  private async atualizar(): Promise<void> {
    const [itensPlataforma, itensTodos, ...contagensArray] = await Promise.all([
      this.cache.getByPlatform(this.platform),
      this.cache.getAll(),
      ...PLATAFORMAS.map((p) => this.cache.countByPlatform(p)),
    ]);
    const contagens: Partial<Record<Platform, number>> = {};
    PLATAFORMAS.forEach((p, i) => {
      contagens[p] = contagensArray[i];
    });
    this.tabs.updateCounts(contagens);
    this.itensPlataforma = itensPlataforma;
    this.itensTodos = itensTodos;
    this.renderGrid();
  }

  private textoStatus(): string {
    if (this.termo) {
      const total = buscarLocal(this.itensTodos, this.termo).length;
      return `${total} resultado${total === 1 ? '' : 's'} para “${this.termo}”`;
    }
    return `${this.itensPlataforma.length} apps nesta aba — carregado do cache local.`;
  }

  // ===== renderização =====

  private renderGrid(): void {
    this.gridEl.replaceChildren();
    if (this.termo) this.renderBusca();
    else this.renderCatalogo();
    this.statusEl.textContent = this.textoStatus();
  }

  private renderCatalogo(): void {
    const lista = [...this.itensPlataforma].sort((a, b) => a.name.localeCompare(b.name, 'pt'));
    const fatia = lista.slice(0, this.limiteVisivel);
    for (const app of fatia) this.gridEl.appendChild(this.cardDe(app));

    if (lista.length > fatia.length) this.gridEl.appendChild(this.botaoMostrarMais(lista.length));

    if (lista.length === 0) {
      this.gridEl.replaceChildren(this.vazio('Nenhum aplicativo no cache para esta plataforma. Toque em “Sincronizar”.'));
    }
  }

  private renderBusca(): void {
    const ranked = buscarLocal(this.itensTodos, this.termo);
    const fatia = ranked.slice(0, this.limiteVisivel);

    // Agrupa por plataforma para o utilizador ver de onde vem cada resultado.
    for (const p of PLATAFORMAS) {
      const grupo = fatia.filter((a) => a.platform === p);
      if (grupo.length === 0) continue;
      const totalGrupo = ranked.filter((a) => a.platform === p).length;
      this.gridEl.appendChild(this.tituloGrupo(ROTULO_PLATAFORMA[p], totalGrupo));
      for (const app of grupo) this.gridEl.appendChild(this.cardDe(app));
    }

    if (ranked.length > fatia.length) this.gridEl.appendChild(this.botaoMostrarMais(ranked.length));

    if (ranked.length === 0) {
      this.gridEl.appendChild(
        this.vazio(`Nenhum resultado local para “${this.termo}”.`),
      );
    }

    // Poucos resultados locais → oferta explícita de buscar no GitHub.
    if (ranked.length < 3 && this.busca.podeBuscarNoGitHub) {
      this.gridEl.appendChild(this.botaoBuscarGitHub());
    }
  }

  private cardDe(app: AppItem): HTMLElement {
    return createAppCard(app, (escolhido) => {
      window.location.hash = `#/app/${encodeURIComponent(escolhido.id)}`;
    });
  }

  private tituloGrupo(rotulo: string, total: number): HTMLElement {
    const h = document.createElement('h2');
    h.className = 'grupo-titulo';
    h.textContent = `${rotulo} (${total})`;
    return h;
  }

  private botaoMostrarMais(total: number): HTMLButtonElement {
    const mais = document.createElement('button');
    mais.type = 'button';
    mais.className = 'btn btn--mais';
    mais.textContent = `Mostrar mais (${total - this.limiteVisivel} restantes)`;
    mais.addEventListener('click', () => {
      this.limiteVisivel += LOTE_VISIVEL;
      this.renderGrid();
    });
    return mais;
  }

  private botaoBuscarGitHub(): HTMLButtonElement {
    const termo = this.termo;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'btn btn--mais btn--remoto';
    botao.textContent = `Não encontrou? Buscar “${termo}” no GitHub`;
    botao.addEventListener('click', () => {
      botao.disabled = true;
      botao.textContent = 'A buscar no GitHub…';
      void this.busca
        .buscarNoGitHub(termo)
        .then((novos) => {
          showToast(novos > 0 ? `${novos} item(ns) novo(s) do GitHub.` : 'O GitHub não devolveu resultados.');
          return this.atualizar();
        })
        .catch(() => {
          botao.disabled = false;
          botao.textContent = `Não encontrou? Buscar “${termo}” no GitHub`;
          showToast('A busca no GitHub falhou — limite da API? Tente mais tarde.', 'erro');
        });
    });
    return botao;
  }

  private vazio(mensagem: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'vazio';
    p.textContent = mensagem;
    return p;
  }

  // ===== sincronização =====

  private async sincronizar(mensagem = 'A sincronizar —'): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    this.syncBtn.disabled = true;
    this.syncBtn.replaceChildren(girar(), document.createTextNode('A sincronizar…'));
    this.statusEl.textContent = `${mensagem} a recolher dados das fontes…`;
    try {
      await syncAll(this.adapters, this.cache, (p) => {
        if (p.status === 'inicio') this.statusEl.textContent = `${mensagem} ${p.source}…`;
        else if (p.status === 'ok') this.statusEl.textContent = `${p.source}: ${p.total ?? 0} apps no cache`;
        else this.statusEl.textContent = `${p.source}: falhou — mantivemos o cache anterior`;
      });
      this.limiteVisivel = LOTE_VISIVEL;
      await this.atualizar();
      showToast('Sincronização concluída.');
      this.statusEl.textContent = 'Catálogo atualizado.';
    } finally {
      this.syncing = false;
      this.syncBtn.disabled = false;
      this.syncBtn.textContent = 'Sincronizar';
    }
  }
}

/** Spinner pequeno para dentro do botão de sincronizar. */
function girar(): HTMLElement {
  const span = document.createElement('span');
  span.className = 'girar';
  span.setAttribute('aria-hidden', 'true');
  return span;
}

/** Tipo estrutural mínimo para localizar o adaptador do GitHub sem importá-lo. */
interface GitHubLike {
  search(termo: string, maxRepos?: number): Promise<AppItem[]>;
}
