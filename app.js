// Ponto de entrada: carrega os dados, liga as abas, a ficha, o hash da URL e carrega mapa e 3D sob demanda.
import { carregarTudo, descreverErro, ARQUIVOS } from './js/dados.js';
import { caixaErro, dataBR } from './js/util.js';
import { utmParaLatLon, distanciaM } from './js/utm.js';
import { montarPainel } from './js/painel.js';
import { criarFicha } from './js/ficha.js';
import { criarMapa } from './js/mapa.js';
import { iniciarCompartilhar } from './js/compartilhar.js';
import { criarCadastro } from './js/cadastro.js';

const $ = (seletor) => document.querySelector(seletor);
const VISTAS = ['painel', 'mapa', '3d'];
const desktop = window.matchMedia('(min-width: 900px)');

const estado = { vista: 'painel', selecao: null, lado: false };
let dados = null;
let fichaCtl = null;
let mapaCtl = null;
let cenaCtl = null;       // criada ao abrir o 3D pela primeira vez
let cenaPronta = false;   // true depois que o GLB terminou de carregar
let cenaCarregando = null;
let painelCtl = null;     // { slot3d, escolher } devolvido pelo montarPainel
let cadastroCtl = null;   // as inspeções gravadas pelo link, no Supabase (js/cadastro.js)
let armadoEm = null;      // 'mapa' ou '3d' enquanto "Nova inspeção" espera o toque

// ---------- avisos curtos ----------
let relogioAviso = 0;
function aviso(texto) {
  const el = $('#aviso');
  clearTimeout(relogioAviso);
  el.textContent = texto;
  el.hidden = !texto;
  if (texto) relogioAviso = setTimeout(() => { el.hidden = true; }, 7000);
}

// ---------- dados auxiliares ----------
const resolvido = () => ({
  ativos: dados.ativos.ok ? dados.ativos.dado : null,
  ficticio: dados.ficticio.ok ? dados.ficticio.dado : null,
  area: dados.area.ok ? dados.area.dado : null,
  ponto: dados.ponto.ok ? dados.ponto.dado : null,
  ponte: dados.ponte.ok ? dados.ponte.dado : null,
  rio: dados.rio.ok ? dados.rio.dado : null,
});
const ativoExiste = (id) => dados.ativos.ok && Boolean(dados.ativos.dado.ativos[id]);

/** A conta de UTM inverso é nossa (não vem de biblioteca): confere contra o geojson, onde a Boca_Bueiro_005 tem a mesma coordenada da patologia. */
function conferirUtm() {
  if (!dados.ponto.ok || !dados.ficticio.ok) return;
  const feicao = dados.ponto.dado.features.find((f) => f.properties.id_ativo === 'Boca_Bueiro_005');
  if (!feicao) { console.error('Conferência de UTM: Boca_Bueiro_005 não está em ativos_ponto.geojson.'); return; }
  const [lng, lat] = feicao.geometry.coordinates;
  const p = dados.ficticio.dado.patologia.utm;
  const erro = distanciaM(utmParaLatLon(p[0], p[1]), { lat, lng });
  if (erro > 0.5) console.error(`Conferência de UTM falhou: a conversão difere do geojson em ${erro.toFixed(2)} m (limite 0,5 m).`);
  else console.info(`Conferência de UTM: diferença de ${(erro * 1000).toFixed(1)} mm em relação ao geojson.`);
}

// ---------- hash da URL ----------
function escreverHash() {
  const p = new URLSearchParams();
  if (estado.vista !== 'painel') p.set('vista', estado.vista);
  if (estado.selecao && estado.selecao.tipo === 'ativo') p.set('ativo', estado.selecao.id);
  if (estado.selecao && estado.selecao.tipo === 'ponte') p.set('ponte', '1');
  const texto = p.toString();
  history.replaceState(null, '', `${location.pathname}${location.search}${texto ? `#${texto}` : ''}`);
}

// ---------- ficha ----------
function selecionar(sel) {
  estado.selecao = sel;
  fichaCtl.mostrar(sel);
  $('.palco').classList.add('com-ficha');
  $('#ficha').setAttribute('aria-hidden', 'false');
  sincronizarDestaques();
  escreverHash();
}
function fecharFicha() {
  estado.selecao = null;
  $('.palco').classList.remove('com-ficha');
  $('#ficha').setAttribute('aria-hidden', 'true');
  sincronizarDestaques();
  escreverHash();
}
function sincronizarDestaques() {
  if (mapaCtl) mapaCtl.destacar(estado.selecao);
  if (cenaPronta) cenaCtl.destacar(estado.selecao);
}

// ---------- cadastro de inspeção pelo link ----------
// O toque comum continua abrindo a ficha, que é o que a banca já aprendeu; "Nova inspeção" arma só o
// próximo toque, que vira o ponto do achado. Trocar de aba, Esc ou Cancelar desarmam.
function desarmarCadastro() {
  if (mapaCtl) mapaCtl.desarmarToque();
  if (cenaCtl) cenaCtl.desarmarToque();
  if (cadastroCtl) cadastroCtl.desarmar();
  $('#btn-nova-inspecao-3d').setAttribute('aria-pressed', 'false');
  armadoEm = null;
}
function novaInspecao(origem) {
  if (armadoEm === origem) { desarmarCadastro(); return; }
  desarmarCadastro();
  const alvo = origem === 'mapa' ? mapaCtl : cenaPronta ? cenaCtl : null;
  if (!alvo) { aviso('O 3D ainda está carregando. Tente de novo em instantes.'); return; }
  armadoEm = origem;
  cadastroCtl.armar({ origem, aoCancelar: desarmarCadastro });
  if (origem === '3d') $('#btn-nova-inspecao-3d').setAttribute('aria-pressed', 'true');
  alvo.armarToque((ponto) => {
    desarmarCadastro();
    cadastroCtl.abrir({ ...ponto, origem });
  });
}
// Depois de carregar a lista ou de gravar: pinos novos no mapa e no 3D, e a ficha aberta refeita. Uma
// gravação nova abre a ficha do ativo, para quem cadastrou ver a inspeção no lugar dela.
function aoMudarCadastro(lista, nova) {
  if (mapaCtl) mapaCtl.adicionarCadastros(lista);
  if (cenaCtl) cenaCtl.adicionarCadastros(lista);
  if (nova) {
    selecionar(nova.id_ativo === 'OAE-01' ? { tipo: 'ponte' } : { tipo: 'ativo', id: nova.id_ativo });
    return;
  }
  if (estado.selecao) fichaCtl.mostrar(estado.selecao);
}

// ---------- mapa ----------
function garantirMapa() {
  if (mapaCtl) { mapaCtl.mostrar(); return; }
  const alvo = $('#mapa');
  const faltam = ['area', 'ponto'].filter((n) => !dados[n].ok);
  if (faltam.length || !window.L) {
    const caixa = faltam.length
      ? faltam.map((n) => caixaErro({ titulo: 'Não consegui carregar o mapa.', ...descreverErro(dados[n].erro, ARQUIVOS[n]) }))
      : [caixaErro({ titulo: 'Não consegui carregar o mapa.', detalhe: 'A biblioteca Leaflet não carregou (unpkg.com).', dica: 'Confira a conexão e recarregue a página.' })];
    console.error('Mapa indisponível:', faltam, window.L ? '' : 'Leaflet ausente');
    alvo.replaceChildren(...caixa.map((c) => Object.assign(c, { className: `${c.className} solta` })));
    return;
  }
  try {
    const d = resolvido();
    mapaCtl = criarMapa(alvo, d, { aoSelecionar: selecionar, aoAlternarLado: alternarLado, aoNovaInspecao: () => novaInspecao('mapa'), aviso });
    mapaCtl.adicionarCadastros(cadastroCtl.lista());
    mapaCtl.mostrar();
    mapaCtl.destacar(estado.selecao);
  } catch (erro) {
    console.error('Falha ao montar o mapa:', erro);
    alvo.replaceChildren(caixaErro({ titulo: 'Não consegui montar o mapa.', detalhe: erro.message }));
  }
}

// ---------- 3D ----------
// O Painel e a aba 3D usam o mesmo 3D (um GLB de 4,9 MB e uma foto aérea de ~1.900 px na memória do
// celular, uma vez só): o contêiner muda de lugar, e o tres_d.js troca a câmera pelo modo.
const no3DdoPainel = () => estado.vista === 'painel' && painelCtl && painelCtl.slot3d;
function posicionarCena() {
  const cena = $('#cena');
  const status = $('#cena-status');
  if (no3DdoPainel()) {
    if (cena.parentElement !== painelCtl.slot3d) painelCtl.slot3d.append(cena, status);
  } else if (cena.parentElement !== $('#vista-3d')) {
    $('#vista-3d').prepend(cena);
    $('#vista-3d').append(status);
  }
}
// No Painel a ponte e o terreno aparecem sempre; as caixas "Mostrar ponte/terreno" são da aba 3D.
function ajustarModoCena() {
  if (!cenaCtl) return;
  const painel = Boolean(no3DdoPainel());
  cenaCtl.modo(painel ? 'painel' : '3d');
  if (!cenaPronta) return;
  cenaCtl.mostrarPonte(painel || $('#chk-ponte').checked);
  cenaCtl.mostrarTerreno(painel || $('#chk-terreno').checked);
}
async function cenaParaOPainel() {
  if (!cenaPronta) await garantirCena();
  return cenaPronta;
}

function mostrarStatus3D(conteudo) {
  const s = $('#cena-status');
  s.hidden = false;
  s.replaceChildren(conteudo);
}

function garantirCena() {
  if (cenaPronta) { cenaCtl.mostrar(); return Promise.resolve(); }
  if (cenaCarregando) return cenaCarregando;
  cenaCarregando = (async () => {
    const texto = document.createElement('p');
    const barra = document.createElement('progress');
    barra.max = 100;
    const caixa = document.createElement('div');
    caixa.className = 'carregando';
    caixa.append(texto, barra);
    texto.textContent = 'Preparando o 3D…';
    mostrarStatus3D(caixa);
    try {
      await null; // garante que o `finally` só rode depois de cenaCarregando ser atribuída, mesmo se o erro vier já na primeira linha
      if (!dados.ativos.ok) throw dados.ativos.erro;
      if (!cenaCtl) {
        const modulo = await import('./js/tres_d.js');
        cenaCtl = modulo.criarCena($('#cena'), resolvido(), {
          // No Painel, tocar no rótulo de um sensor faz o mesmo que tocar na linha dele.
          aoSelecionar: (sel, info) => {
            if (info && info.origem === 'pino' && no3DdoPainel() && painelCtl.escolher(info.chave)) return;
            selecionar(sel);
          },
          aoLimpar: fecharFicha,
        });
        cenaCtl.adicionarCadastros(cadastroCtl.lista());
      }
      cenaCtl.modo(no3DdoPainel() ? 'painel' : '3d');
      cenaCtl.mostrar();
      await cenaCtl.carregar(ARQUIVOS.modelo, ({ lidos, total }) => {
        const mb = (lidos / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
        if (total) {
          const pct = Math.min(100, Math.round((lidos / total) * 100));
          texto.textContent = `Baixando o modelo 3D… ${pct}%`;
          barra.value = pct;
        } else {
          texto.textContent = `Baixando o modelo 3D… ${mb} MB`;
          barra.removeAttribute('value');
        }
      });
      cenaPronta = true;
      $('#cena-status').hidden = true;
      $('#cena-status').replaceChildren();
      ajustarModoCena();
      cenaCtl.destacar(estado.selecao);
    } catch (erro) {
      console.error('Falha ao carregar o 3D:', erro);
      const base = erro && erro.arquivo
        ? descreverErro(erro, ARQUIVOS.modelo)
        : {
          arquivo: ARQUIVOS.modelo,
          detalhe: `Motivo: ${(erro && erro.message) || erro}.`,
          dica: /webgl/i.test(String(erro && erro.message))
            ? 'Este aparelho ou navegador não conseguiu iniciar o 3D (WebGL). Tente outro navegador.'
            : 'Se for erro de rede, confira a conexão (o three.js vem de cdn.jsdelivr.net) e tente de novo.',
        };
      mostrarStatus3D(caixaErro({ titulo: 'Não consegui carregar o 3D.', ...base, aoTentar: () => { cenaCarregando = null; irParaVista(estado.vista); } }));
    } finally {
      cenaCarregando = null;
    }
  })();
  return cenaCarregando;
}

// ---------- vistas ----------
const ladoEfetivo = () => estado.lado && estado.vista === 'mapa' && desktop.matches;

function aplicarVisibilidade() {
  const lado = ladoEfetivo();
  $('#vista-painel').hidden = estado.vista !== 'painel';
  $('#vista-mapa').hidden = !(estado.vista === 'mapa');
  $('#vista-3d').hidden = !(estado.vista === '3d' || lado);
  $('.vistas').classList.toggle('lado', lado);
  document.querySelectorAll('.aba').forEach((b) => {
    const ativa = b.dataset.vista === estado.vista;
    b.setAttribute('aria-selected', String(ativa));
    b.tabIndex = ativa ? 0 : -1;
  });
  posicionarCena();
  if (cenaCtl) {
    if (estado.vista === '3d' || lado || no3DdoPainel()) { cenaCtl.mostrar(); ajustarModoCena(); } else cenaCtl.esconder();
  }
  if (mapaCtl) mapaCtl.marcarLado(lado);
}

async function irParaVista(vista, { focar = null } = {}) {
  if (!VISTAS.includes(vista)) vista = 'painel';
  // O toque armado é de uma vista só: levado para outra, cairia num lugar que a pessoa não escolheu.
  if (armadoEm && armadoEm !== vista) desarmarCadastro();
  estado.vista = vista;
  if (vista !== 'mapa') estado.lado = false;
  aplicarVisibilidade();
  escreverHash();
  const lado = ladoEfetivo();
  if (vista === 'mapa' || lado) garantirMapa();
  if (vista === '3d' || lado || no3DdoPainel()) await garantirCena();
  if (focar && focar.tipo === 'ativo') {
    if (mapaCtl && (vista === 'mapa')) mapaCtl.focarAtivo(focar.id);
    if (cenaPronta && (vista === '3d' || lado)) cenaCtl.focarAtivo(focar.id);
  }
  if (focar && focar.tipo === 'ponte') {
    if (mapaCtl && (vista === 'mapa')) mapaCtl.focarPonte();
    if (cenaPronta && (vista === '3d' || lado)) cenaCtl.focarPonte();
  }
}

async function alternarLado() {
  if (!desktop.matches) return;
  estado.lado = !estado.lado;
  await irParaVista('mapa');
}

/** Usado pelo Painel: vai para a vista, abre a ficha do ativo do marcador e centraliza no ponto. */
async function verMarcador(nome, vista) {
  const fic = dados.ficticio.dado;
  await irParaVista(vista);
  const doLink = nome.startsWith('cad-') ? cadastroCtl.lista().find((c) => `cad-${c.id}` === nome) : null;
  // O medidor do rio é da ponte, que não tem ficha de ativo: abre a ficha da ponte.
  if (nome === 'rio' || (doLink && doLink.id_ativo === 'OAE-01')) selecionar({ tipo: 'ponte' });
  else if (doLink) selecionar({ tipo: 'ativo', id: doLink.id_ativo });
  else selecionar({ tipo: 'ativo', id: nome === 'patologia' ? fic.patologia.id_ativo : fic.sensor.id_ativo });
  if (vista === 'mapa' && mapaCtl) mapaCtl.focarMarcador(nome);
  if (vista === '3d' && cenaPronta) cenaCtl.focarPino(nome);
}

// ---------- hash de entrada ----------
async function aplicarHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  const ativo = p.get('ativo');
  let vista = p.get('vista');
  if (ativo && !vista) vista = 'mapa';
  if (p.get('ponte')) {
    const sel = { tipo: 'ponte' };
    selecionar(sel);
    await irParaVista(vista || '3d', { focar: sel });
    return;
  }
  if (ativo && !ativoExiste(ativo)) {
    aviso(`O ativo "${ativo}" do link não existe nos dados.`);
    console.error(`Link com ativo desconhecido: ${ativo}`);
  }
  const sel = ativo && ativoExiste(ativo) ? { tipo: 'ativo', id: ativo } : null;
  if (sel) selecionar(sel);
  await irParaVista(vista || 'painel', { focar: sel });
}

// ---------- início ----------
function ligarBarras() {
  document.querySelectorAll('.aba').forEach((b) => b.addEventListener('click', () => irParaVista(b.dataset.vista)));
  $('#btn-compartilhar').addEventListener('click', iniciarCompartilhar($('#dlg-compartilhar')));
  $('#chk-ponte').addEventListener('change', (e) => cenaCtl && cenaCtl.mostrarPonte(e.target.checked));
  $('#chk-terreno').addEventListener('change', (e) => cenaCtl && cenaCtl.mostrarTerreno(e.target.checked));
  $('#btn-ver-tudo').addEventListener('click', () => cenaPronta && cenaCtl.verTudo());
  $('#btn-pino-patologia').addEventListener('click', () => cenaPronta && cenaCtl.focarPino('patologia'));
  $('#btn-pino-sensor').addEventListener('click', () => cenaPronta && cenaCtl.focarPino('sensor'));
  $('#btn-pino-rio').addEventListener('click', () => cenaPronta && cenaCtl.focarPino('rio'));
  $('#btn-nova-inspecao-3d').addEventListener('click', () => novaInspecao('3d'));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (armadoEm) desarmarCadastro();
    else if (estado.selecao) fecharFicha();
  });
  desktop.addEventListener('change', () => { aplicarVisibilidade(); if (mapaCtl) mapaCtl.mostrar(); });
  window.addEventListener('hashchange', () => { aplicarHash().catch((e) => console.error('Falha ao aplicar o link:', e)); });
}

async function iniciar() {
  ligarBarras();
  const painel = $('#vista-painel');
  painel.replaceChildren(Object.assign(document.createElement('p'), { className: 'carregando-texto', textContent: 'Carregando os dados…' }));
  dados = await carregarTudo();
  if (dados.ficticio.ok) $('#faixa-data').textContent = dataBR(dados.ficticio.dado.data_simulada);
  conferirUtm();
  cadastroCtl = criarCadastro({ dados, aviso });
  fichaCtl = criarFicha({
    raiz: $('#ficha'),
    dados,
    cadastro: cadastroCtl,
    acoes: {
      fechar: fecharFicha,
      ir: (vista, sel) => irParaVista(vista, { focar: sel }),
    },
  });
  painelCtl = montarPainel(painel, dados, {
    verMarcador,
    abrirPonte: () => selecionar({ tipo: 'ponte' }),
    abrirFicha: (sel) => selecionar(sel),
    cadastro: cadastroCtl,
    // O Painel pode pedir o voo antes de o 3D terminar de baixar: espera, e desiste em silêncio só se
    // o 3D falhou (o erro já está na janela, com o botão de tentar de novo).
    cena: {
      voar: async (chave) => { if (await cenaParaOPainel()) cenaCtl.voar(chave); },
      voltar: async () => { if (await cenaParaOPainel()) cenaCtl.voltarParaPonte(); },
    },
  });
  // Sem await: o banco do link é de fora (Supabase) e pode demorar a acordar; a página não espera por
  // ele, e as inspeções aparecem quando chegarem. A falha vira aviso lá dentro, nunca tela em branco.
  cadastroCtl.aoMudar(aoMudarCadastro);
  cadastroCtl.carregar();
  await aplicarHash();
}

iniciar().catch((erro) => {
  console.error('Falha inesperada ao iniciar a página:', erro);
  $('#vista-painel').replaceChildren(caixaErro({ titulo: 'A página não conseguiu iniciar.', detalhe: erro.message }));
});
