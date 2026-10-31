/** Utilidades partilhadas pelos adaptadores e pela UI. */

export function nowIso(): string {
  return new Date().toISOString();
}

export function truncate(texto: string, max = 400): string {
  const t = texto.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Remove tags HTML e decodifica as entidades mais comuns. */
export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Converte markdown (típico de release notes do GitHub) em texto plano. */
export function limparMarkdown(texto: string): string {
  return texto
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // imagens
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → texto
    .replace(/^\s*\|[\s:|-]+\|\s*$/gm, ' ') // separadores de tabela
    .replace(/[|`>#_*~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Deduplica por chave derivada. */
export function uniqueBy<T>(itens: T[], chave: (item: T) => string): T[] {
  const vistos = new Set<string>();
  const resultado: T[] = [];
  for (const item of itens) {
    const k = chave(item);
    if (vistos.has(k)) continue;
    vistos.add(k);
    resultado.push(item);
  }
  return resultado;
}

/** Executa `fn` com no máximo `limite` chamadas em voo. */
export async function mapLimit<T, R>(
  itens: T[],
  limite: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const resultados: R[] = new Array(itens.length);
  let indice = 0;
  const trabalhadores = Array.from({ length: Math.max(1, limite) }, async () => {
    while (indice < itens.length) {
      const atual = indice++;
      resultados[atual] = await fn(itens[atual]!);
    }
  });
  await Promise.all(trabalhadores);
  return resultados;
}

/** Formata bytes em pt (ex.: “1,4 MB”); devolve “—” quando desconhecido. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '—';
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i++;
  }
  const num = new Intl.NumberFormat('pt', {
    maximumFractionDigits: valor >= 100 || i === 0 ? 0 : 1,
  }).format(valor);
  return `${num} ${unidades[i]}`;
}

/** Último segmento do caminho da URL, se tiver extensão; senão null. */
export function nomeArquivoDeUrl(url: string): string | null {
  try {
    const ultimo = new URL(url).pathname.split('/').pop() ?? '';
    const nome = decodeURIComponent(ultimo);
    return nome.includes('.') ? nome : null;
  } catch {
    return null;
  }
}
