/**
 * Smoke test dos adaptadores reescritos (roda em Node via esbuild bundle).
 * Uso: GH_TOKEN=... node /tmp/teste-adaptadores.mjs
 */
import { GitHubAdapter, estadoEmMemoria } from '../src/core/adapters/github.adapter';
import { FdroidAdapter } from '../src/core/adapters/fdroid.adapter';
import { MemoryAppCache } from '../src/data/cache';
import { syncAll } from '../src/core/sync/SyncOrchestrator';
import type { AppItem } from '../src/core/models/AppItem';

const token = process.env.GH_TOKEN;
let falhas = 0;

function verificar(cond: boolean, rotulo: string): void {
  console.log(`${cond ? '✓' : '✗ FALHOU'} — ${rotulo}`);
  if (!cond) falhas++;
}

function resumo(app: AppItem): string {
  const v = app.versions?.length ?? 0;
  return `${app.id} | ${app.platform} | ${app.version ?? '?'} | ${v} versões | ${(app.versions?.[0]?.fileName ?? app.fileName) ?? '—'}`;
}

// ===== 1. Busca remota: termo livre precisa achar o repo do usuário =====
const github = new GitHubAdapter({ token, estado: estadoEmMemoria() });
const busca = await github.search('xcoder');
const achou = busca.find((a) => a.id.startsWith('github:carsaimz/xcoder#'));
console.log(`Busca "xcoder": ${busca.length} itens; ids: ${busca.map((a) => a.id).join(' , ') || '(nenhum)'}`);
verificar(Boolean(achou), 'busca "xcoder" encontra carsaimz/xcoder');
if (achou) {
  verificar(achou.platform === 'android', 'xcoder classificado como Android (APK)');
  verificar((achou.versions?.length ?? 0) >= 2, `xcoder tem versões agrupadas (${achou.versions?.length})`);
  verificar(Boolean(achou.versions?.[0]?.downloadUrl), 'versão mais recente tem downloadUrl');
  console.log('  →', resumo(achou));
}

// ===== 2. Busca remota: owner/repo exato =====
const direto = await github.search('carsaimz/Concat');
console.log(`Busca "carsaimz/Concat": ${direto.map((a) => a.id).join(' , ') || '(nenhum)'}`);
verificar(direto.some((a) => a.id.startsWith('github:carsaimz/Concat#') || a.id === 'github:carsaimz/Concat'), 'busca owner/repo funciona');

// ===== 3. fetchAll: pool rotativo com lotes incrementais =====
const github2 = new GitHubAdapter({
  token,
  estado: estadoEmMemoria(),
  maxReposPorSync: 8,
});
const lotes: AppItem[][] = [];
const itens = await github2.fetchAll((lote) => lotes.push(lote));
const android = itens.filter((a) => a.platform === 'android');
console.log(`fetchAll(8 repos): ${itens.length} itens (${android.length} android); lotes recebidos: ${lotes.length}`);
verificar(itens.length > 0, 'fetchAll devolve itens');
verificar(lotes.length > 0, 'fetchAll emite lotes incrementais (onPartial)');
verificar(itens.every((a) => !a.id.includes('@')), 'ids novos não têm "@..." (agrupados por app)');
const comVersoes = itens.filter((a) => (a.versions?.length ?? 0) > 1);
console.log(`  com >1 versões: ${comVersoes.length}; exemplo: ${comVersoes[0] ? resumo(comVersoes[0]) : '—'}`);

// ===== 4. F-Droid leve: semente + versões =====
const fdroid = new FdroidAdapter({ estado: estadoEmMemoria(), pacotesPorSync: 4, enriquecerSite: true });
const fdItens = await fdroid.fetchAll();
console.log(`F-Droid (4 pacotes): ${fdItens.map((a) => `${a.id} [${a.name}] ${a.versions?.length}v`).join(' ; ') || '(nenhum)'}`);
verificar(fdItens.length >= 2, 'F-Droid devolve pacotes do catálogo semente');
verificar(fdItens.every((a) => (a.versions?.length ?? 0) >= 1), 'F-Droid: cada pacote tem versões');
verificar(fdItens.every((a) => a.downloadUrl?.includes('_')), 'F-Droid: URL de APK no padrão {pkg}_{versionCode}.apk');
const comIcone = fdItens.filter((a) => a.iconUrl);
console.log(`  com ícone do site: ${comIcone.length}/${fdItens.length}`);

// ===== 5. syncAll + cache em memória (fluxo completo de orquestração) =====
const cache = new MemoryAppCache();
const progressos: string[] = [];
await syncAll([fdroid, github2], cache, (p) => progressos.push(`${p.source}:${p.status}${p.total != null ? `(${p.total})` : ''}`));
const todos = await cache.getAll();
console.log(`syncAll: ${progressos.join(' ')} → cache com ${todos.length} itens`);
verificar(todos.length >= itens.length, 'syncAll persistiu os lotes no cache');
verificar(progressos.some((p) => p.includes(':progresso')), 'syncAll emitiu eventos de progresso');
verificar((await cache.countByPlatform('android')) > 0, 'cache tem apps Android');

console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} VERIFICAÇÃO(ÕES) FALHARAM`);
process.exit(falhas === 0 ? 0 : 1);
