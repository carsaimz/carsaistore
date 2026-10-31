import type { AppItem, Platform } from '../../core/models/AppItem';
import type { SourceAdapter } from '../../core/adapters/SourceAdapter';
import type { AppCache } from '../../data/cache';
import { syncAll, syncIfStale } from '../../core/sync/SyncOrchestrator';
import { PlatformTabs } from '../components/PlatformTabs';
import { createAppCard } from '../components/AppCard';
import { showToast } from '../components/Toast';

const PLATAFORMAS: Platform[] = ['android', 'ios', 'desktop'];
/** Paginação do grid: evita montar milhares de cards de uma vez. */
const LOTE_VISIVEL = 120;

/**
 * Página principal: abas Android | iOS | Desktop + busca + grid de cards.
 * Regra do documento: a UI só lê do cache; a busca NUNCA dispara sincronização.
 */
export class CatalogPage {
  private platform: Platform = 'android';
  private termo = '';
  private limiteVisivel = LOTE_VISIVEL;
  private syncing = false;
  private tabs: PlatformTabs;

  private gridEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private syncBtn!: HTMLButtonElement;

  constructor(
    private cache: AppCache,
    private adapters: SourceAdapter[],
  ) {
    this.tabs = new PlatformTabs((p) => {
      void this.setPlatform(p);
    });
  }

  async mount(root: HTMLElement): Promise<void> {
    root.replaceChildren();

    // Cabeçalho
    const header = document.createElement('header');
    header.className = 'topo';
    const titulo = document.createElement('h1');
    titulo.textContent = 'Carsai Store';
    const sub = document.createElement('p');
    sub.className = 'topo__sub';
    sub.textContent = 'Catálogo unificado de aplicativos — Android, iOS e Desktop.';
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
    header.append(titulo, sub, acoes);

    // Busca
    const busca = document.createElement('input');
    busca.type = 'search';
    busca.className = 'busca';
    busca.placeholder = 'Buscar aplicativos…';
    busca.setAttribute('aria-label', 'Buscar aplicativos');
    let timer: number | undefined;
    busca.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        this.termo = busca.value.trim().toLowerCase();
        this.limiteVisivel = LOTE_VISIVEL;
        this.renderGrid();
      }, 200);
    });

    // Abas
    const tabsEl = document.createElement('nav');
    tabsEl.className = 'tabs';
    this.tabs.mount(tabsEl);

    // Estado + grid
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'status';
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.textContent = 'A carregar o cache local…';
    this.gridEl = document.createElement('div');
    this.gridEl.className = 'grade';

    root.append(header, busca, tabsEl, this.statusEl, this.gridEl);

    await this.atualizar();

    // Primeira utilização: cache vazio → sincronização completa com feedback.
    const contagens = await Promise.all(PLATAFORMAS.map((p) => this.cache.countByPlatform(p)));
    const total = contagens.reduce((a, b) => a + b, 0);
    if (total === 0) {
      await this.sincronizar('A preparar o catálogo pela primeira vez —');
    } else {
      // Rotina de fundo: sincroniza se alguma fonte passou de 24 h (não bloqueia).
      void syncIfStale(this.adapters, this.cache)
        .then((rodou) => {
          if (rodou) {
            void this.atualizar();
            showToast('Catálogo atualizado automaticamente.');
          } else {
            this.statusEl.textContent = 'Catálogo carregado do cache local.';
          }
        })
        .catch(() => {
          this.statusEl.textContent = 'Catálogo carregado do cache local.';
        });
    }
  }

  private async setPlatform(p: Platform): Promise<void> {
    this.platform = p;
    this.limiteVisivel = LOTE_VISIVEL;
    await this.atualizar();
  }

  private async atualizar(): Promise<void> {
    const itens = await this.cache.getByPlatform(this.platform);
    const contagensArray = await Promise.all(PLATAFORMAS.map((p) => this.cache.countByPlatform(p)));
    const contagens: Partial<Record<Platform, number>> = {};
    PLATAFORMAS.forEach((p, i) => {
      contagens[p] = contagensArray[i];
    });
    this.tabs.updateCounts(contagens);
    this.all = itens;
    this.renderGrid();
  }

  private all: AppItem[] = [];

  private renderGrid(): void {
    const termo = this.termo;
    const filtrado = termo
      ? this.all.filter((a) =>
          [a.name, a.description, a.developer ?? '', a.tags.join(' ')]
            .join(' ')
            .toLowerCase()
            .includes(termo),
        )
      : this.all;
    const lista = [...filtrado].sort((a, b) => a.name.localeCompare(b.name, 'pt'));

    this.gridEl.replaceChildren();
    const fatia = lista.slice(0, this.limiteVisivel);
    for (const app of fatia) {
      this.gridEl.appendChild(
        createAppCard(app, (escolhido) => {
          window.location.hash = `#/app/${encodeURIComponent(escolhido.id)}`;
        }),
      );
    }

    if (lista.length > fatia.length) {
      const mais = document.createElement('button');
      mais.type = 'button';
      mais.className = 'btn btn--mais';
      mais.textContent = `Mostrar mais (${lista.length - fatia.length} restantes)`;
      mais.addEventListener('click', () => {
        this.limiteVisivel += LOTE_VISIVEL;
        this.renderGrid();
      });
      this.gridEl.appendChild(mais);
    }

    if (lista.length === 0) {
      const vazio = document.createElement('p');
      vazio.className = 'vazio';
      vazio.textContent = termo
        ? 'Nenhum aplicativo encontrado para esta busca.'
        : 'Nenhum aplicativo no cache para esta plataforma. Toque em “Sincronizar”.';
      this.gridEl.replaceChildren(vazio);
    }
  }

  private async sincronizar(mensagem = 'A sincronizar —'): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    this.syncBtn.disabled = true;
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
    }
  }
}
