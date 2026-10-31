let host: HTMLElement | null = null;

function hospedeiro(): HTMLElement {
  if (!host) {
    host = document.getElementById('toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      document.body.appendChild(host);
    }
  }
  return host;
}

export function showToast(mensagem: string, tipo: 'ok' | 'erro' = 'ok'): void {
  const el = document.createElement('div');
  el.className = `toast toast--${tipo}`;
  el.setAttribute('role', 'status');
  el.textContent = mensagem;
  hospedeiro().appendChild(el);
  window.setTimeout(() => {
    el.classList.add('toast--saindo');
    window.setTimeout(() => el.remove(), 350);
  }, 3400);
}
