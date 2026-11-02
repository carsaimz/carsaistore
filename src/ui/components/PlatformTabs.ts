import type { Platform } from '../../core/models/AppItem';
import { ROTULO_PLATAFORMA } from '../labels';

const ORDEM: Platform[] = ['android', 'ios', 'desktop'];

/** As três abas fixas do catálogo: Android | iOS | Desktop. */
export class PlatformTabs {
  private botoes = new Map<Platform, HTMLButtonElement>();
  private atual: Platform = 'android';
  private el: HTMLElement;

  constructor(private onChange: (p: Platform) => void) {
    this.el = document.createElement('div');
    this.el.className = 'tabs__grupo';
    this.el.setAttribute('role', 'tablist');
    for (const p of ORDEM) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tabs__tab';
      b.setAttribute('role', 'tab');
      const rotulo = document.createElement('span');
      rotulo.textContent = ROTULO_PLATAFORMA[p];
      const contagem = document.createElement('span');
      contagem.className = 'tabs__contagem';
      b.append(rotulo, contagem);
      b.addEventListener('click', () => this.set(p));
      this.botoes.set(p, b);
      this.el.appendChild(b);
    }
    this.pintar();
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
  }

  get value(): Platform {
    return this.atual;
  }

  set(p: Platform): void {
    if (p === this.atual) return;
    this.atual = p;
    this.pintar();
    this.onChange(p);
  }

  updateCounts(contagens: Partial<Record<Platform, number>>): void {
    for (const [p, b] of this.botoes) {
      const c = b.querySelector('.tabs__contagem');
      if (c) c.textContent = String(contagens[p] ?? 0);
    }
  }

  private pintar(): void {
    for (const [p, b] of this.botoes) {
      const ativo = p === this.atual;
      b.classList.toggle('tabs__tab--ativo', ativo);
      b.setAttribute('aria-selected', String(ativo));
    }
  }
}
