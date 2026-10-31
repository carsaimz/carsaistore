import { Capacitor } from '@capacitor/core';
import { FileTransfer } from '@capacitor/file-transfer';
import { Directory, Filesystem } from '@capacitor/filesystem';

/**
 * Resultado de uma tentativa de download:
 * - success:     ficheiro guardado (caminho devolvido);
 * - fallback:    o download direto falhou → fallbackUrl aberto no navegador;
 * - unavailable: falhou e não existe fallbackUrl → “Download indisponível”.
 */
export type DownloadOutcome =
  | { status: 'success'; path: string }
  | { status: 'fallback'; reason: string }
  | { status: 'unavailable'; reason: string };

export type ProgressoDownload = (baixado: number, total: number) => void;

/** Abre um URL fora do WebView: navegador do sistema no nativo, nova aba no browser. */
export function openExternal(url: string): void {
  if (Capacitor.isNativePlatform()) {
    window.open(url, '_system');
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

/**
 * Serviço de download da app. Regras do documento técnico:
 * 1. resolve o destino em Documentos/Downloads/{fileName};
 * 2. baixa com `@capacitor/file-transfer` (Filesystem.downloadFile está
 *    deprecado desde 7.1.0);
 * 3. em falha (rede/403/404), abre `fallbackUrl` com `_system` e devolve
 *    { status: 'fallback' }.
 * No browser (fora do build nativo) usa a âncora de download padrão.
 */
export class DownloadService {
  static async download(
    url: string,
    fileName: string,
    fallbackUrl: string | null,
    onProgress?: ProgressoDownload,
  ): Promise<DownloadOutcome> {
    if (Capacitor.isNativePlatform()) {
      return DownloadService.baixarNativo(url, fileName, fallbackUrl, onProgress);
    }
    return DownloadService.baixarWeb(url, fileName, fallbackUrl);
  }

  private static async baixarNativo(
    url: string,
    fileName: string,
    fallbackUrl: string | null,
    onProgress?: ProgressoDownload,
  ): Promise<DownloadOutcome> {
    try {
      const destino = await DownloadService.resolverDestino(fileName);

      let listener: { remove: () => Promise<void> } | null = null;
      if (onProgress) {
        try {
          listener = await FileTransfer.addListener('progress', (evento) => {
            const e = evento as { progress?: number; loaded?: number; total?: number };
            if (typeof e.loaded === 'number' && typeof e.total === 'number' && e.total > 0) {
              onProgress(e.loaded, e.total);
            } else if (typeof e.progress === 'number') {
              onProgress(e.progress, 1);
            }
          });
        } catch {
          listener = null; // progresso não suportado: seguimos sem ele
        }
      }

      try {
        await FileTransfer.downloadFile({ url, path: destino, progress: Boolean(onProgress) });
      } finally {
        if (listener) {
          try {
            await listener.remove();
          } catch {
            /* ignora */
          }
        }
      }

      return { status: 'success', path: destino };
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      if (fallbackUrl) {
        openExternal(fallbackUrl);
        return { status: 'fallback', reason: motivo };
      }
      return { status: 'unavailable', reason: motivo };
    }
  }

  private static async resolverDestino(fileName: string): Promise<string> {
    const ops = { directory: Directory.Documents, path: `Downloads/${fileName}` } as const;
    try {
      const { uri } = await Filesystem.getUri(ops);
      return uri;
    } catch {
      await Filesystem.mkdir({
        directory: Directory.Documents,
        path: 'Downloads',
        recursive: true,
      }).catch(() => undefined);
      const { uri } = await Filesystem.getUri(ops);
      return uri;
    }
  }

  private static async baixarWeb(
    url: string,
    fileName: string,
    fallbackUrl: string | null,
  ): Promise<DownloadOutcome> {
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return { status: 'success', path: fileName };
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      if (fallbackUrl) {
        openExternal(fallbackUrl);
        return { status: 'fallback', reason: motivo };
      }
      return { status: 'unavailable', reason: motivo };
    }
  }
}
