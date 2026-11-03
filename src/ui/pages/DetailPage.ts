import type { AppItem, AppVersion } from '../../core/models/AppItem';
import type { AppCache } from '../../data/cache';
import { formatBytes, repoUrlDe, rotuloVersao } from '../../core/util';
import { ROTULO_FONTE, ROTULO_PLATAFORMA } from '../labels';
import { createAppIcon } from '../components/AppCard';
import { createDownloadButton } from '../components/DownloadButton';
import { criarBotaoGitHub } from '../components/GitHubLink';

/** Página de detalhe: lê o app do cache pelo id e mostra info + botão de download. */
export class DetailPage {
  constructor(private cache: AppCache) {}

  async mount(root: HTMLElement, id: string): Promise<void> {
    root.replaceChildren();

    // Se a rota mudar enquanto lemos o cache, não escrevemos na página nova.
    const minhaRota = window.location.hash;
    let app: AppItem | null = null;
    try {
      app = await this.cache.getById(id);
    } catch {
      app = null;
    }
    if ((window.location.hash || '#/') !== (minhaRota || '#/')) return;

    const voltar = document.createElement('a');
    voltar.className = 'voltar';
    voltar.href = '#/';
    voltar.textContent = '← Voltar ao catálogo';
    root.appendChild(voltar);

    if (!app) {
      const aviso = document.createElement('p');
      aviso.className = 'vazio';
      aviso.textContent =
        'Aplicativo não encontrado no cache local. Volte ao catálogo e sincronize novamente.';
      root.appendChild(aviso);
      return;
    }

    const artigo = document.createElement('article');
    artigo.className = 'detalhe';

    // Topo: ícone + nome + desenvolvedor
    const topo = document.createElement('div');
    topo.className = 'detalhe__topo';
    topo.appendChild(createAppIcon(app, 'detalhe__icone'));
    const info = document.createElement('div');
    info.className = 'detalhe__info';
    const h2 = document.createElement('h2');
    h2.textContent = app.name;
    const dev = document.createElement('p');
    dev.className = 'detalhe__dev';
    dev.textContent = app.developer ?? ROTULO_FONTE[app.source];
    info.append(h2, dev);
    topo.appendChild(info);
    artigo.appendChild(topo);

    // Ação principal: baixar + (se disponível) ver no GitHub
    const acoes = document.createElement('div');
    acoes.className = 'detalhe__acoes';
    acoes.appendChild(createDownloadButton(app));
    const repo = repoUrlDe(app);
    if (repo) {
      acoes.appendChild(criarBotaoGitHub(repo, 'btn btn--gh', { rotulo: 'Ver no GitHub' }));
    }
    artigo.appendChild(acoes);

    // Descrição
    const desc = document.createElement('p');
    desc.className = 'detalhe__desc';
    desc.textContent = app.description || 'Sem descrição disponível.';
    artigo.appendChild(desc);

    // Versões: todas as conhecidas, mais recente primeiro — o utilizador
    // escolhe qual baixar. Cada linha tem o seu próprio botão de download.
    if (app.versions && app.versions.length > 0) {
      artigo.appendChild(secaoVersoes(app));
    }

    // Tags
    if (app.tags.length > 0) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const tag of app.tags.slice(0, 8)) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = tag;
        chips.appendChild(chip);
      }
      artigo.appendChild(chips);
    }

    // Metadados
    const dl = document.createElement('dl');
    dl.className = 'meta';
    const linhas: Array<[string, string]> = [
      ['Fonte', ROTULO_FONTE[app.source]],
      ['Plataforma', ROTULO_PLATAFORMA[app.platform]],
      ['Versão', app.version ?? '—'],
      ['Tamanho', formatBytes(app.sizeBytes)],
      ['Preço', app.price === 0 ? 'Gratuito' : app.price != null ? String(app.price) : '—'],
      ['Coletado em', formatarData(app.fetchedAt)],
    ];
    for (const [k, v] of linhas) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }
    if (app.fallbackUrl) {
      const dt = document.createElement('dt');
      dt.textContent = 'Página oficial';
      const dd = document.createElement('dd');
      const a = document.createElement('a');
      a.href = app.fallbackUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = app.fallbackUrl;
      dd.appendChild(a);
      dl.append(dt, dd);
    }
    artigo.appendChild(dl);

    root.appendChild(artigo);
  }
}

function formatarData(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt');
}

/**
 * Seção “Versões”: uma linha por versão (mais recente primeiro), cada uma com
 * botão de download próprio — é aqui que o utilizador escolhe qual baixar.
 * A primeira linha vem assinalada como a mais recente.
 */
function secaoVersoes(app: AppItem): HTMLElement {
  const secao = document.createElement('section');
  secao.className = 'versoes';

  const titulo = document.createElement('h3');
  titulo.className = 'versoes__titulo';
  titulo.textContent = `Versões (${app.versions!.length})`;
  secao.appendChild(titulo);

  app.versions!.forEach((versao, indice) => {
    secao.appendChild(linhaVersao(app, versao, indice === 0));
  });
  return secao;
}

function linhaVersao(app: AppItem, versao: AppVersion, maisRecente: boolean): HTMLElement {
  const linha = document.createElement('div');
  linha.className = 'versao';

  const info = document.createElement('div');
  info.className = 'versao__info';

  const topo = document.createElement('div');
  topo.className = 'versao__topo';
  const tag = document.createElement('span');
  tag.className = 'versao__tag';
  tag.textContent = rotuloVersao(versao.version) ?? versao.version;
  topo.appendChild(tag);
  if (maisRecente) {
    const recente = document.createElement('span');
    recente.className = 'versao__recente';
    recente.textContent = 'mais recente';
    topo.appendChild(recente);
  }
  info.appendChild(topo);

  const detalhe = document.createElement('div');
  detalhe.className = 'versao__meta';
  const pedacos = [
    versao.fileName,
    versao.sizeBytes ? formatBytes(versao.sizeBytes) : null,
    versao.publishedAt ? formatarData(versao.publishedAt) : null,
  ].filter((x): x is string => Boolean(x));
  detalhe.textContent = pedacos.join(' · ');
  info.appendChild(detalhe);

  if (versao.notes) {
    const notas = document.createElement('details');
    notas.className = 'versao__notas';
    const sumario = document.createElement('summary');
    sumario.textContent = 'Novidades';
    const texto = document.createElement('p');
    texto.textContent = versao.notes;
    notas.append(sumario, texto);
    info.appendChild(notas);
  }

  linha.appendChild(info);
  if (versao.downloadUrl) {
    linha.appendChild(createDownloadButton(app, versao));
  }
  return linha;
}
