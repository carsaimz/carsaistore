import './ui/styles.css';

import { createCache } from './data/cache';
import type { SourceAdapter } from './core/adapters/SourceAdapter';
import { FdroidAdapter } from './core/adapters/fdroid.adapter';
import { GitHubAdapter } from './core/adapters/github.adapter';
import { ITunesAdapter } from './core/adapters/itunes.adapter';
import { HomebrewAdapter } from './core/adapters/homebrew.adapter';
import { FlathubAdapter } from './core/adapters/flathub.adapter';
import { WingetAdapter } from './core/adapters/winget.adapter';
import { CatalogPage } from './ui/pages/CatalogPage';
import { DetailPage } from './ui/pages/DetailPage';

const env = import.meta.env as Record<string, string | undefined>;

const cache = createCache();

// Uma instância por fonte — a ordem define a ordem da sincronização.
const adaptadores: SourceAdapter[] = [
  new FdroidAdapter(),
  new GitHubAdapter({ token: env.VITE_GITHUB_TOKEN }),
  new ITunesAdapter(),
  new HomebrewAdapter(),
  new FlathubAdapter(),
  new WingetAdapter({ apiKey: env.VITE_WINGET_API_KEY }),
];

const raiz = document.querySelector<HTMLDivElement>('#app')!;
const catalogo = new CatalogPage(cache, adaptadores);
const detalhe = new DetailPage(cache);

/** Roteamento por hash: `#/` = catálogo, `#/app/{id}` = detalhe. */
function rotear(): void {
  const casamento = /^#\/app\/(.+)$/.exec(window.location.hash);
  if (casamento) {
    void detalhe.mount(raiz, decodeURIComponent(casamento[1]!));
    return;
  }
  void catalogo.mount(raiz);
}

window.addEventListener('hashchange', rotear);
rotear();
