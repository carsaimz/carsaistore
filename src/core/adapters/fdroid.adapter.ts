import type { AppItem, AppVersion } from '../models/AppItem';
import type { SourceAdapter } from './SourceAdapter';
import type { EstadoAdaptador } from './github.adapter';
import { estadoEmMemoria } from './github.adapter';
import { mapLimit, nowIso, stripHtml, truncate } from '../util';

const API_BASE = 'https://f-droid.org/api/v1/packages';
const SITE_BASE = 'https://f-droid.org/packages';
const REPO_BASE = 'https://f-droid.org/repo';

interface FdroidApiPacote {
  packageName?: string;
  packages?: Array<{ versionName?: string; versionCode?: number }>;
}

export interface FdroidAdapterOptions {
  /** Quantos pacotes visitar por sincronização (rotação via estado). */
  pacotesPorSync?: number;
  /** Versões guardadas por pacote (mais recentes primeiro). */
  versoesPorPacote?: number;
  /** Preencher nome/ícone/descrição a partir da página do site (og:meta). */
  enriquecerSite?: boolean;
  estado?: EstadoAdaptador;
}

/**
 * Catálogo semente do F-Droid: nomes de pacote (`packageName`) populares e
 * estáveis. A API v1 oficial não expõe busca nem listagem completa sem baixar
 * o índice de ~70 MB — impraticável num telemóvel. Cada nome aqui baixa, na
 * prática, um APK da F-Droid. Um nome inexistente custa 1 pedido 404 e é
 * ignorado sem quebrar a fonte.
 */
const PACOTES_SEME = [
  'org.schabi.newpipe',
  'org.adaway',
  'com.aurora.store',
  'org.fdroid.fdroid',
  'net.osmand.plus',
  'app.organicmaps',
  'fr.neamar.kiss',
  'org.quantumbadger.redreader',
  'com.machiav3lli.fdroid',
  'com.droidify',
  'io.github.muntashirakon.AppManager',
  'eu.faircode.email',
  'com.beemdevelopment.aegis',
  'de.danoeh.antennapod',
  'net.sourceforge.opencamera',
  'org.videolan.vlc',
  'is.xyz.mpv',
  'org.xbmc.kodi',
  'com.nextcloud.client',
  'com.github.catfriend1.syncthingandroid',
  'org.torproject.android',
  'org.torproject.torbrowser',
  'org.mozilla.fennec_fdroid',
  'org.proninyaroslav.libretorrent',
  'com.termux',
  'com.termux.api',
  'org.connectbot',
  'eu.siacs.conversations',
  'org.briarproject.briar.android',
  'net.cozic.joplin',
  'org.tasks',
  'org.gnucash.android',
  'com.money.manager.ex',
  'de.schildbach.wallet',
  'org.kiwix.kiwixmobile',
  'org.dolphinemu.dolphinemu',
  'com.simplemobiletools.gallery.pro',
  'code.name.monkey.retromusic',
  'com.poupa.vinylmusicplayer',
  'com.kabouzeid.gramophone',
  'org.y20k.transistor',
  'org.y20k.trackbook',
  'org.ligi.survivalmanual',
  'com.osfans.trime',
  'com.nononsenseapps.notepad',
  'net.gsantner.markor',
  'com.kunzisoft.keepass.free',
  'net.osmand',
  'com.termux.widget',
  'io.github.sspanak.tt9',
  'com.geeksville.mesh',
  'io.homeassistant.companion.android.minimal',
];

/**
 * Adaptador do F-Droid LEVE:
 * 1. rotação por um catálogo semente de `packageName`s (cursor persistido);
 * 2. `GET /api/v1/packages/{pkg}` devolve TODAS as versões do pacote →
 *    `AppItem.versions` (agrupadas; o APK segue o padrão oficial
 *    `{pkg}_{versionCode}.apk`);
 * 3. best-effort: a página `f-droid.org/packages/{pkg}` fornece nome de
 *    exibição, ícone e resumo via og:meta (falha não derruba o item).
 *
 * Nota CORS: f-droid.org não envia Access-Control-Allow-Origin — no browser a
 * fonte pode falhar; no build nativo o `CapacitorHttp` (ativo no
 * capacitor.config.ts) faz as chamadas pela camada nativa e contorna CORS.
 */
export class FdroidAdapter implements SourceAdapter {
  readonly source = 'fdroid' as const;
  readonly platform = 'android' as const;

  private readonly pacotesPorSync: number;
  private readonly versoesPorPacote: number;
  private readonly enriquecerSite: boolean;
  private readonly estado: EstadoAdaptador;

  constructor(options: FdroidAdapterOptions = {}) {
    this.pacotesPorSync = options.pacotesPorSync ?? 60;
    this.versoesPorPacote = options.versoesPorPacote ?? 15;
    this.enriquecerSite = options.enriquecerSite ?? true;
    this.estado = options.estado ?? estadoEmMemoria();
  }

  async fetchAll(onPartial?: (lote: AppItem[]) => void | Promise<void>): Promise<AppItem[]> {
    // Catálogo efetivo: semente sem entradas inválidas de revisão (“?no”).
    const catalogo = PACOTES_SEME.filter((p) => !p.includes('?'));
    const cursor = await this.numero('fdroid:cursor');
    const tamanho = Math.min(this.pacotesPorSync, catalogo.length);
    const fatia: string[] = [];
    for (let i = 0; i < tamanho; i++) fatia.push(catalogo[(cursor + i) % catalogo.length]!);
    if (catalogo.length > 0) {
      await this.estado.set('fdroid:cursor', String((cursor + tamanho) % catalogo.length));
    }

    const itens: AppItem[] = [];
    await mapLimit(fatia, 4, async (pkg) => {
      try {
        const item = await this.itemDePacote(pkg);
        if (item) {
          itens.push(item);
          await onPartial?.([item]);
        }
      } catch {
        // pacote inexistente/indisponível: segue para o próximo
      }
    });
    return itens;
  }

  private async itemDePacote(pkg: string): Promise<AppItem | null> {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(pkg)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const dados = (await res.json()) as FdroidApiPacote;

    const brutas = (dados.packages ?? [])
      .filter((v) => typeof v.versionCode === 'number')
      .sort((a, b) => (b.versionCode ?? 0) - (a.versionCode ?? 0))
      .slice(0, this.versoesPorPacote);
    if (brutas.length === 0) return null;

    const versoes: AppVersion[] = brutas.map((v) => {
      const arquivo = `${pkg}_${v.versionCode}.apk`;
      return {
        version: v.versionName ?? String(v.versionCode),
        platform: 'android' as const,
        downloadUrl: `${REPO_BASE}/${arquivo}`,
        fileName: arquivo,
        sizeBytes: null, // a API v1 não publica tamanho por versão
      };
    });

    const site = this.enriquecerSite ? await this.metaDoSite(pkg) : null;
    const primeira = versoes[0]!;

    return {
      id: `fdroid:${pkg}`,
      name: site?.nome ?? this.nomeBonito(pkg),
      description: site?.resumo ?? '',
      iconUrl: site?.icone ?? '',
      platform: 'android',
      source: 'fdroid',
      downloadUrl: primeira.downloadUrl,
      fallbackUrl: `${SITE_BASE}/${pkg}/`,
      fileName: primeira.fileName,
      sizeBytes: primeira.sizeBytes,
      version: primeira.version,
      versions: versoes,
      price: 0,
      tags: ['f-droid'],
      fetchedAt: nowIso(),
    };
  }

  /** og:meta da página do pacote: nome de exibição, ícone e resumo. */
  private async metaDoSite(pkg: string): Promise<{ nome: string; resumo: string; icone: string } | null> {
    try {
      const res = await fetch(`${SITE_BASE}/${encodeURIComponent(pkg)}/`, {
        headers: { Accept: 'text/html' },
      });
      if (!res.ok) return null;
      const html = truncate(await res.text(), 120_000); // og:meta está no <head>
      const prop = (nome: string): string | null => {
        const m = new RegExp(
          `<meta[^>]+property=["']og:${nome}["'][^>]+content=["']([^"']+)["']`,
          'i',
        ).exec(html);
        if (m) return stripHtml(m[1]!);
        // ordem alternada dos atributos também existe
        const m2 = new RegExp(
          `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${nome}["']`,
          'i',
        ).exec(html);
        return m2 ? stripHtml(m2[1]!) : null;
      };
      const nome = prop('title');
      if (!nome) return null;
      // og:title vem com sufixo do site: “NewPipe | F-Droid - Free and …”
      const nomeLimpo = nome.replace(/\s*[|·—-]\s*F-Droid.*$/i, '').trim();
      return {
        nome: nomeLimpo || nome,
        resumo: prop('description') ?? '',
        icone: prop('image') ?? '',
      };
    } catch {
      return null;
    }
  }

  /** `org.schabi.newpipe` → “Newpipe” (fallback quando não há página). */
  private nomeBonito(pkg: string): string {
    const ultimo = pkg.split('.').pop() ?? pkg;
    return ultimo.replace(/[-_]+/g, ' ').trim() || pkg;
  }

  private async numero(chave: string): Promise<number> {
    const valor = await this.estado.get(chave);
    const n = Number.parseInt(valor ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
}
