import type { AppItem } from '../../core/models/AppItem';
import { formatBytes, repoUrlDe, rotuloVersao } from '../../core/util';
import { ROTULO_FONTE } from '../labels';
import { criarBotaoGitHub } from './GitHubLink';

/** Ícone do app com fallback automático para avatar com a inicial. */
export function createAppIcon(app: AppItem, className: string): HTMLElement {
  if (app.iconUrl) {
    const img = document.createElement('img');
    img.className = className;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.replaceWith(createAvatar(app, className)));
    img.src = app.iconUrl;
    return img;
  }
  return createAvatar(app, className);
}

function createAvatar(app: AppItem, className: string): HTMLElement {
  const span = document.createElement('span');
  span.className = `${className} avatar`;
  span.setAttribute('aria-hidden', 'true');
  span.textContent = (app.name.trim()[0] ?? '?').toUpperCase();
  return span;
}

/**
 * Card do catálogo. Estrutura: wrapper `.app-card` com o botão principal
 * (abre o detalhe) e, quando o app tem repositório no GitHub, um botão-ícone
 * lateral “Ver no GitHub” que abre o repo sem navegar para o detalhe.
 */
export function createAppCard(app: AppItem, aoSelecionar: (app: AppItem) => void): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'app-card';

  const principal = document.createElement('button');
  principal.type = 'button';
  principal.className = 'app-card__principal';
  principal.setAttribute('aria-label', app.name);
  principal.appendChild(createAppIcon(app, 'app-card__icone'));

  const corpo = document.createElement('div');
  corpo.className = 'app-card__corpo';

  const nome = document.createElement('span');
  nome.className = 'app-card__nome';
  nome.textContent = app.name;

  const tamanho = formatBytes(app.sizeBytes);
  const quantidadeVersoes = app.versions?.length ?? 0;
  const pedacos = [
    app.developer,
    rotuloVersao(app.version),
    tamanho === '—' ? null : tamanho,
    // Assinala que há mais versões para escolher dentro do detalhe.
    quantidadeVersoes > 1 ? `${quantidadeVersoes} versões` : null,
  ].filter((x): x is string => Boolean(x));

  const meta = document.createElement('span');
  meta.className = 'app-card__meta';
  meta.textContent = pedacos.join(' · ') || ROTULO_FONTE[app.source];

  corpo.append(nome, meta);
  principal.appendChild(corpo);

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = ROTULO_FONTE[app.source];
  principal.appendChild(badge);

  principal.addEventListener('click', () => aoSelecionar(app));
  wrapper.appendChild(principal);

  const repo = repoUrlDe(app);
  if (repo) {
    wrapper.appendChild(criarBotaoGitHub(repo, 'app-card__gh'));
  }

  return wrapper;
}
