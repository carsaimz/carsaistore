import type { AppItem, AppVersion } from '../../core/models/AppItem';
import { DownloadService, openExternal } from '../../core/download/DownloadService';
import { nomeArquivoDeUrl } from '../../core/util';
import { showToast } from './Toast';

/**
 * Botão de download com o comportamento exato do documento:
 * - downloadUrl === null → nasce como “Abrir na loja” (nunca tenta baixar);
 * - download direto falha → fallbackUrl aberto no navegador do sistema;
 * - ambos ausentes → “Download indisponível no momento” (desabilitado).
 *
 * `versao` (opcional) escolhe um binário específico da lista de versões do
 * app — usado na lista de versões do detalhe. Sem versão, usa a atual
 * (`app.downloadUrl`, a mais recente).
 */
export function createDownloadButton(app: AppItem, versao?: AppVersion): HTMLButtonElement {
  const urlEscolhida = versao?.downloadUrl ?? app.downloadUrl;
  const nomeEscolhido = versao?.fileName ?? app.fileName;

  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'btn btn--primario' + (versao ? ' btn--versao' : ' btn--bloco');

  const pintaPadrao = (): void => {
    if (urlEscolhida) botao.textContent = 'Baixar';
    else if (app.fallbackUrl) botao.textContent = 'Abrir na loja';
    else botao.textContent = 'Download indisponível no momento';
    botao.disabled = !urlEscolhida && !app.fallbackUrl;
  };
  pintaPadrao();

  botao.addEventListener('click', () => {
    if (!urlEscolhida) {
      if (app.fallbackUrl) openExternal(app.fallbackUrl);
      return;
    }

    const url = urlEscolhida;
    const nome = nomeEscolhido ?? nomeArquivoDeUrl(url) ?? 'download';
    botao.disabled = true;
    botao.textContent = 'Preparando…';

    void DownloadService.download(url, nome, app.fallbackUrl, (baixado, total) => {
      botao.textContent =
        total > 0 ? `Baixando ${Math.min(100, Math.round((baixado / total) * 100))}%` : 'Baixando…';
    }).then((resultado) => {
      if (resultado.status === 'success') {
        botao.textContent = 'Concluído ✓';
        showToast(`Download concluído: ${resultado.path}`);
        window.setTimeout(pintaPadrao, 4000);
      } else if (resultado.status === 'fallback') {
        pintaPadrao();
        showToast('Não foi possível baixar diretamente — abrimos a página oficial no navegador.', 'erro');
      } else {
        botao.textContent = 'Download indisponível no momento';
        showToast('Download indisponível no momento.', 'erro');
      }
    });
  });

  return botao;
}
