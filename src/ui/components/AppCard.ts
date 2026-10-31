import type { AppItem } from '../../core/models/AppItem';
import { formatBytes } from '../../core/util';
import { ROTULO_FONTE } from '../labels';

/** Ícone do app com fallback automático para avatar com a inicial. */
export function createAppIcon(app: AppItem, className: string): HTMLElement {
  if (app.iconUrl) {
    const img = document.createElement('img');
    img.className = className;
    img.alt = '';
    img.loading = 'lazy';
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

export function createAppCard(app: AppItem, aoSelecionar: (app: AppItem) => void): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'app-card';
  card.setAttribute('aria-label', app.name);
  card.appendChild(createAppIcon(app, 'app-card__icone'));

  const corpo = document.createElement('div');
  corpo.className = 'app-card__corpo';

  const nome = document.createElement('span');
  nome.className = 'app-card__nome';
  nome.textContent = app.name;

  const tamanho = formatBytes(app.sizeBytes);
  const pedacos = [
    app.developer,
    app.version ? `v${app.version}` : null,
    tamanho === '—' ? null : tamanho,
  ].filter((x): x is string => Boolean(x));

  const meta = document.createElement('span');
  meta.className = 'app-card__meta';
  meta.textContent = pedacos.join(' · ') || ROTULO_FONTE[app.source];

  corpo.append(nome, meta);
  card.appendChild(corpo);

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = ROTULO_FONTE[app.source];
  card.appendChild(badge);

  card.addEventListener('click', () => aoSelecionar(app));
  return card;
}
