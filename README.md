# Carsai Store

**Loja de aplicativos agregadora (Android · iOS · Desktop) em TypeScript + Capacitor.**

O Carsai Store reúne num único catálogo apps de seis fontes públicas, normaliza tudo para um
contrato único (`AppItem`) e guarda o resultado num **cache local**. A UI **nunca** chama APIs
externas — ela só lê do cache — e o botão de download **baixa o binário diretamente** quando a
fonte fornece um; em caso de falha, cai automaticamente para o navegador do sistema
(`fallbackUrl`).

## Arquitetura

```
Fontes (APIs públicas)          Adapters (1 por fonte)         Cache local              UI
──────────────────────         ──────────────────────         ────────────────         ───────────────────
F-Droid        ─┐                                              ┌─ IndexedDB  ─┐
GitHub         ─┤→  fetchAll() → AppItem[]  ─→ SyncOrchestrator │  (upsert)    │ ─→  Abas: Android | iOS | Desktop
iTunes         ─┤    (normalização)             (tolerante a    └──────────────┘     Busca no cache
Homebrew       ─┤                                falhas por      fetchedAt/fonte     DownloadButton
Flathub        ─┤                                fonte)                               (direto → fallback _system)
Winget         ─┘
```

- **`AppItem` / `AppVersion`** (`src/core/models/AppItem.ts`): contrato único — `id` determinístico
  (`${source}:${idOriginal}`), `downloadUrl` só quando existe binário real, `fileName` com
  extensão correta, `fetchedAt` para a política de 24 h — e, nas fontes com histórico
  (GitHub, F-Droid), **`versions[]`**: todas as versões conhecidas do app, mais recente
  primeiro, cada uma com o seu binário. O card mostra a atual; o detalhe lista todas.
- **`SourceAdapter`** (`src/core/adapters/SourceAdapter.ts`): uma implementação por fonte.
- **`SyncOrchestrator`** (`src/core/sync/SyncOrchestrator.ts`): manual (botão) + automático
  (> 24 h desde `fetchedAt`, em fundo, nunca no caminho crítico de busca/detalhe). Falha de uma
  fonte preserva o cache anterior e não impede as demais. Os adaptadores emitem **lotes
  incrementais** (`onPartial`): o que já foi coletado é persistido na hora, então uma falha no
  meio da coleta não perde o progresso (a UI mostra “fonte: N apps coletados…”).
- **`DownloadService`** (`src/core/download/DownloadService.ts`):
  `@capacitor/file-transfer` → `Documentos/Downloads/{fileName}`; falha → abre `fallbackUrl`
  com `window.open(url, '_system')`; sem fallback → estado “Download indisponível no momento”.
- **`SearchService`** (`src/core/search/SearchService.ts`): busca 100% local sobre o cache —
  insensível a acentos/maiúsculas, por palavras (ordem livre) e **ranqueada**
  (nome > id > developer > tags > descrição), em **todas as plataformas**
  (a UI agrupa por aba). Com poucos resultados locais, um botão explícito busca o termo
  no GitHub e grava os itens no cache (nunca dispara sincronização automática).

## Fontes de dados

| Fonte | Plataforma | Download direto | Observações |
| --- | --- | --- | --- |
| **F-Droid** (API v1 + catálogo semente) | Android | ✅ APK (`{pkg}_{versionCode}.apk`) | A API v1 oficial devolve TODAS as versões de cada pacote (agrupadas no detalhe); nome/ícone/resumo vêm da página do pacote (og:meta). Não usamos o índice `index-v2.json` (~70 MB). Sementes rotativas de ~55 pacotes populares por sincronização. |
| **GitHub** (Search + Releases) | Android/Desktop | ✅ asset da release | **Um item por app e plataforma** (`github:owner/repo#android`), com todas as versões agrupadas; dentro de um release, `.apk` tem prioridade sobre `.aab`. Descoberta por pool rotativo (sementes verificadas + buscas por tópico, cursor persistido — cada sync visita um pedaço novo). Só assets com extensões de app. Busca remota: `owner/repo` direto, termo com matches **por nome primeiro** (acha repos pequenos/novos). 60 req/h sem token — configure `VITE_GITHUB_TOKEN`. |
| **iTunes Search** (`price=0`, `entity=software`) | iOS | ❌ (por definição) | Apple não fornece binário: o botão nasce como “Abrir na loja” (`trackViewUrl`). |
| **Homebrew Casks** (`cask.json`) | Desktop (macOS) | ✅ se extensão inferível | Sem extensão clara → fallback para a homepage. |
| **Flathub** (`/api/v2/appstream`) | Desktop (Linux) | ✅ `.flatpakref` | Lista de IDs é barata; detalhes são enriquecidos em lotes rotativos de 150 apps por sincronização. |
| **Winget** (API comunitária) | Desktop (Windows) | ❌ | Serviço instável e com `X-API-Key`; fallback aponta para o manifest em `microsoft/winget-pkgs`. Em produção, consuma os manifests JSON diretamente. |

## Versões agrupadas

Repositórios que publicam várias releases não viram mais vários cards: o catálogo mostra
**um card por app** (com a versão atual e, quando houver mais, “N versões”), e a página de
detalhe tem a seção **“Versões”** — uma linha por versão, com nome do ficheiro, tamanho,
data, “Novidades” (release notes) e **botão de baixar próprio**. A migração do cache
(IDB v1→v2) remove automaticamente os ids antigos `github:repo@tag` na primeira abertura.

## Busca e “Ver no GitHub”

- **Busca entre plataformas**: com um termo ativo, as abas são ignoradas e os resultados
  aparecem agrupados (`Android (n) · iOS (n) · Desktop (n)`), ranqueados por relevância.
  Trocar de aba ou pressionar `Esc` limpa a busca.
- **Busca remota no GitHub**: se o catálogo local tem menos de 3 resultados, aparece o botão
  **“Não encontrou? Buscar “termo” no GitHub”**. É uma ação explícita: os resultados entram
  no cache e passam a fazer parte do catálogo (inclusive na aba correspondente).
- **“Ver no GitHub”**: apps com repositório conhecido (fonte GitHub, ou homepage no GitHub
  detectada no Homebrew/Flathub/fallback) mostram um botão-ícone no card e um botão
  “Ver no GitHub” na página de detalhe.

## Requisitos

- Node.js ≥ 18
- Para build nativo: Android Studio (Android) e/ou Xcode (iOS)

## Como executar

```bash
# 1. Dependências
npm install

# 2. Desenvolvimento no navegador
npm run dev            # http://localhost:5173

# 3. Build de produção (typecheck + bundle em dist/)
npm run build

# 4. Empacotar como app nativo (após o primeiro build)
npx cap add android
npx cap add ios        # apenas em macOS
npx cap sync
npx cap open android   # ou: npx cap open ios
```

## Configuração opcional (`.env`)

```bash
cp .env.example .env
```

| Variável | Efeito |
| --- | --- |
| `VITE_GITHUB_TOKEN` | Eleva a API do GitHub de 60 para 5.000 req/h. |
| `VITE_WINGET_API_KEY` | Chave da API comunitária do Winget (`X-API-Key`). |

O token fica **apenas no seu `.env`** (ignorado pelo git) — nunca embutido no código.

## Comportamento do download

| Situação | O que acontece |
| --- | --- |
| `downloadUrl` presente | Baixa o ficheiro imediatamente para `Documentos/Downloads/` com barra de percentagem. |
| Download falha (rede/403/404) | Abre `fallbackUrl` no navegador do sistema e avisa com um toast. |
| `downloadUrl` null (iTunes/Winget) | Botão nasce como **“Abrir na loja”** — nunca tenta baixar. |
| Ambos null | Botão desabilitado: **“Download indisponível no momento”**. |

## Estrutura de pastas

```
src/
├── core/
│   ├── models/AppItem.ts            # contrato de dados unificado
│   ├── adapters/
│   │   ├── SourceAdapter.ts
│   │   ├── fdroid.adapter.ts
│   │   ├── github.adapter.ts
│   │   ├── itunes.adapter.ts
│   │   ├── homebrew.adapter.ts
│   │   ├── flathub.adapter.ts
│   │   └── winget.adapter.ts
│   ├── search/SearchService.ts      # busca local ranqueada + busca remota no GitHub
│   ├── sync/SyncOrchestrator.ts     # manual + 24h, tolerante a falhas
│   └── download/DownloadService.ts  # file-transfer + fallback _system
├── data/cache.ts                    # IndexedDB (+ fallback em memória)
├── ui/
│   ├── components/                  # PlatformTabs, AppCard, DownloadButton, GitHubLink, Toast
│   ├── pages/                       # CatalogPage, DetailPage
│   └── styles.css
├── main.ts                          # wiring + roteamento por hash
capacitor.config.ts
index.html
```

## Limitações conhecidas

- **GitHub sem token**: a descoberta fica limitada (~60 req/h); o pool rotativo usa bem menos
  que isso por sincronização, mas o catálogo cresce muito mais rápido com um token (5.000 req/h)
  em `VITE_GITHUB_TOKEN` — sobretudo para a busca remota.
- **F-Droid no navegador**: f-droid.org não envia cabeçalhos CORS, então no browser essa fonte
  falha (aviso no console; o resto do catálogo segue). No app **nativo** isto está resolvido:
  o `CapacitorHttp` (ativado em `capacitor.config.ts`) faz o `fetch()` passar pela camada
  nativa, imune a CORS.
- **F-Droid: catálogo semente**: sem baixar o índice de ~70 MB, a fonte percorre um catálogo
  semente de pacotes populares (rotativo). Acrescente pacotes em `PACOTES_SEME`
  (`fdroid.adapter.ts`) para expandir.
- **Winget**: a API comunitária pode estar fora do ar; a fonte simplesmente não atualiza e o
  cache anterior continua disponível.
- **iOS**: por decisão da Apple, apps do iTunes abrem sempre a App Store; binários `.ipa`
  do GitHub aparecem quando publicados em releases.
- **ApkPure/Play Store** não são suportados: sem API pública oficial de binários.
