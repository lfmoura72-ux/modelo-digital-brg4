// Janela "Compartilhar": QR code do endereço atual (sem o #), link em texto e botão de copiar.
import { h, caixaErro } from './util.js';

const SEM_HASH = () => location.href.split('#')[0];

// O SVG é montado à mão a partir dos módulos do QR: assim o fundo branco e a margem ("zona de silêncio")
// ficam garantidos e a imagem escala sem borrar no projetor.
function desenharQR(url, alvo) {
  if (!window.qrcode) {
    console.error('A biblioteca qrcode-generator não carregou (cdnjs.cloudflare.com).');
    alvo.replaceChildren(caixaErro({ titulo: 'Não consegui gerar o QR code.', detalhe: 'A biblioteca qrcode-generator não carregou. Use o link abaixo.' }));
    return;
  }
  const qr = window.qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  const margem = 4;
  const lado = n + margem * 2;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${lado} ${lado}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `QR code do endereço ${url}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const fundo = document.createElementNS(ns, 'rect');
  fundo.setAttribute('width', String(lado));
  fundo.setAttribute('height', String(lado));
  fundo.setAttribute('fill', '#FFFFFF');
  svg.append(fundo);
  let d = '';
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) if (qr.isDark(r, c)) d += `M${c + margem} ${r + margem}h1v1h-1z`;
  }
  const caminho = document.createElementNS(ns, 'path');
  caminho.setAttribute('d', d);
  caminho.setAttribute('fill', '#000000');
  svg.append(caminho);
  alvo.replaceChildren(svg);
}

async function copiar(texto, campo) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch (erro) {
    console.warn('navigator.clipboard falhou, tentando o recuo com execCommand:', erro);
  }
  campo.focus();
  campo.select();
  try {
    return document.execCommand('copy');
  } catch (erro) {
    console.error('Não consegui copiar o link:', erro);
    return false;
  }
}

export function iniciarCompartilhar(dialogo) {
  const qrCaixa = dialogo.querySelector('.qr-caixa');
  const campo = dialogo.querySelector('.link-campo');
  const msg = dialogo.querySelector('.link-msg');
  dialogo.querySelector('.btn-fechar-dlg').addEventListener('click', () => dialogo.close());
  // Clique no fundo escurecido (fora do cartão) fecha.
  dialogo.addEventListener('click', (e) => { if (e.target === dialogo) dialogo.close(); });
  dialogo.querySelector('.btn-copiar').addEventListener('click', async () => {
    const ok = await copiar(campo.value, campo);
    msg.textContent = ok ? 'Link copiado.' : 'Não consegui copiar sozinho: toque no link, selecione e copie.';
  });
  campo.addEventListener('focus', () => campo.select());

  return function abrir() {
    const url = SEM_HASH();
    campo.value = url;
    msg.textContent = '';
    desenharQR(url, qrCaixa);
    if (!dialogo.open) dialogo.showModal();
  };
}

export { h };
