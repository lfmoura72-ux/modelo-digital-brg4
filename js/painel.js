// Vista Painel, a "Sala de operação" que o dono escolheu em 02/11/2026 entre três esboços: a condição
// geral numa frase montada dos dados, o que pede atenção, o modelo 3D da ponte (que o app.js põe no
// `slot3d`), a agenda das próximas inspeções e os sensores, cada um com a curva e o gráfico que abre ao toque.
// No computador são três colunas e a página não rola; no celular, uma coluna com o 3D grudado no topo.
import {
  h, seloFicticio, seloModelo, caixaErro, rotuloTipo, corDoTipo, COR_CONDICAO, COR_SENSOR,
  estadoDoSensor, estadoDoRio, estadoDoSensorPonte, fraseDoSensor, fmtNum, fmtDec, fmtM, fmtMm, fmtVazao,
  fmtValorSensor, dataBR, dataCurta, dataHoraBR, COR_RIO,
} from './util.js';
import { descreverErro } from './dados.js';
import {
  criarGraficoSensor, descricaoDoGrafico, criarGraficoRio, descricaoDoGraficoRio,
  criarGraficoPonte, descricaoDoGraficoPonte, corNoEscuro,
} from './graficos.js';
import { listaDeInspecoes } from './ficha.js';
import { listaDoLink, seloLink } from './cadastro.js';

const SVG = 'http://www.w3.org/2000/svg';
const NIVEL_AMBAR = COR_SENSOR['Atenção'];
const COR_RIO_NO_ESCURO = corNoEscuro(COR_RIO);

const largo = window.matchMedia('(min-width: 900px)');
let proximoId = 0;
const novoId = (prefixo) => `${prefixo}-${++proximoId}`;

function erroDeArquivo(resultado, arquivo, titulo) {
  console.error(`${titulo} (${arquivo}):`, resultado.erro);
  return caixaErro({ titulo, ...descreverErro(resultado.erro, arquivo) });
}

// Na frase, o tipo do AIM soa como planilha ("Tubo de drenagem"); a banca lê "bueiro".
const NOME_NA_FRASE = { 'Tubo de drenagem': 'bueiro', 'Boca de bueiro': 'boca de bueiro', 'Talude de corte': 'talude de corte' };
const nomeNaFrase = (tipo) => NOME_NA_FRASE[tipo] || rotuloTipo(tipo).toLowerCase();

const COMO_ESTA = { Normal: 'está normal', 'Atenção': 'segue em atenção', Alerta: 'está em alerta' };

// "Pendência" é reparo aberto: só a patologia conta. O talude em atenção é vigiado pelo sensor,
// não tem serviço pedido, e por isso não pinta a faixa (o esboço aprovado tem um traço laranja só).
function condicaoGeral(dados) {
  if (!dados.ativos.ok) return erroDeArquivo(dados.ativos, 'dados/ativos.json', 'Não consegui carregar os ativos do modelo.');
  if (!dados.ficticio.ok) return erroDeArquivo(dados.ficticio, 'dados/gemeo_ficticio.json', 'Não consegui carregar a patologia e os sensores.');
  const ativos = dados.ativos.dado.ativos;
  const { patologia: p, sensor: s, sensor_rio: r } = dados.ficticio.dado;
  const sensoresPonte = Array.isArray(dados.ficticio.dado.sensores_ponte) ? dados.ficticio.dado.sensores_ponte : [];
  const lista = Object.values(ativos);
  const comReparo = new Set(p ? [p.id_ativo] : []);
  const total = lista.length;
  const semPendencia = lista.filter((a) => !comReparo.has(a.id_ativo)).length;

  const partes = [];
  if (p && ativos[p.id_ativo]) partes.push(`o ${nomeNaFrase(ativos[p.id_ativo].tipo)} ${p.id_ativo} pede reparo até ${dataCurta(p.prazo)}`);
  if (s) {
    const alvo = ativos[s.id_ativo] ? nomeNaFrase(ativos[s.id_ativo].tipo) : s.id_ativo;
    partes.push(`o ${alvo} ${COMO_ESTA[estadoDoSensor(s).nome]}`);
  }
  // Os nomes dos três sensores da estrutura ("Erosão no pilar", "Junta do encontro leste", "Vibração do
  // vão central") são todos femininos, por isso o "a" fixo; um sensor novo com nome masculino pede ajuste aqui.
  const foraDaPonte = sensoresPonte.map((x) => ({ x, est: estadoDoSensorPonte(x) })).filter(({ est }) => est.nome !== 'Normal');
  const rioNormal = r && estadoDoRio(r).nome === 'Normal';
  if (rioNormal && sensoresPonte.length && !foraDaPonte.length) {
    partes.push('o rio e a estrutura da ponte estão normais');
  } else {
    if (r) partes.push(`o rio sob a ponte ${COMO_ESTA[estadoDoRio(r).nome]}`);
    foraDaPonte.forEach(({ x, est }) => partes.push(`a ${x.nome.toLowerCase()} está em ${est.nome.toLowerCase()}`));
  }
  const segunda = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}` : partes.join('');

  const cor = corNoEscuro(COR_CONDICAO[p && p.gravidade] || COR_CONDICAO.Ruim);
  return h('section', { class: 'condicao' },
    h('p', { class: 'condicao-frase' },
      `Dos ${fmtNum(total)} ativos, ${fmtNum(semPendencia)} estão sem pendência. `,
      segunda ? `${segunda.charAt(0).toUpperCase()}${segunda.slice(1)}.` : ''),
    h('div', { class: 'faixa-ativos', 'aria-hidden': 'true' },
      lista.map((a) => h('span', {
        class: 'traco', title: a.id_ativo,
        estilo: comReparo.has(a.id_ativo) ? { background: cor } : null,
      }))),
    h('p', { class: 'condicao-legenda' },
      `Um traço por ativo do AIM; em laranja, o que tem reparo aberto. Situação simulada de ${dataBR(dados.ficticio.dado.data_simulada)} `,
      seloFicticio()));
}

// ---------- as linhas que abrem ----------
// Só uma linha fica aberta na página inteira (as de "Pede atenção" e as dos sensores contam juntas),
// porque cada uma leva a câmera 3D até um ponto e duas abertas deixariam a câmera sem dono.
function criarControleDeLinhas(acoes, aoMudar) {
  let aberta = null;

  function voar(chave) {
    try {
      const r = acoes.cena.voar(chave);
      if (r && typeof r.catch === 'function') r.catch((erro) => console.error(`Painel: a câmera 3D não chegou em "${chave}":`, erro));
    } catch (erro) {
      console.error(`Painel: falha ao levar a câmera 3D até "${chave}":`, erro);
    }
  }
  function voltar() {
    try {
      const r = acoes.cena.voltar();
      if (r && typeof r.catch === 'function') r.catch((erro) => console.error('Painel: a câmera 3D não voltou para a ponte:', erro));
    } catch (erro) {
      console.error('Painel: falha ao voltar a câmera 3D para a ponte:', erro);
    }
  }

  function fechar(l) {
    if (!l.aberta) return;
    l.aberta = false;
    l.cab.setAttribute('aria-expanded', 'false');
    l.el.classList.remove('aberta');
    // O Chart.js guarda ResizeObserver e tela própria; sem destroy(), cada abertura deixaria um gráfico vivo.
    if (l.grafico) { l.grafico.destroy(); l.grafico = null; }
    l.corpo.replaceChildren();
    l.corpo.hidden = true;
  }

  function abrirSemVoar(l) {
    if (aberta && aberta !== l) fechar(aberta);
    aberta = l;
    l.aberta = true;
    l.cab.setAttribute('aria-expanded', 'true');
    l.el.classList.add('aberta');
    const { nos, grafico } = l.montar();
    l.corpo.replaceChildren(...nos);
    l.corpo.hidden = false;
    // O Chart.js mede a caixa ao nascer; criado na mesma volta em que a caixa deixa de estar escondida, sai com 0 px.
    if (grafico) {
      requestAnimationFrame(() => {
        if (!l.aberta) return;
        try {
          l.grafico = grafico.criar(grafico.canvas);
        } catch (erro) {
          console.error(`Falha ao desenhar o gráfico da linha "${l.chave}" no Painel:`, erro);
          grafico.caixa.replaceChildren(caixaErro({ titulo: 'Não consegui desenhar o gráfico do sensor.', detalhe: erro.message }));
        }
      });
    }
    aoMudar(aberta);
  }

  return {
    /** Toque na linha: abre (e leva a câmera) ou, se já estava aberta, fecha e volta para a ponte. */
    alternar(l) {
      if (l.aberta) {
        fechar(l);
        aberta = null;
        voltar();
        aoMudar(null);
      } else {
        abrirSemVoar(l);
        voar(l.chave);
      }
    },
    /** Toque num rótulo do 3D: abre sempre, nunca fecha, e leva a câmera de novo (ela pode ter sido mexida). */
    abrir(l) {
      abrirSemVoar(l);
      voar(l.chave);
    },
    voltarParaPonte() {
      if (aberta) fechar(aberta);
      aberta = null;
      voltar();
      aoMudar(null);
    },
  };
}

/** Os dois pedaços de um gráfico que abre numa linha: a caixa, e a fábrica que só roda com a caixa na página. */
function caixaDeGrafico(descricao, criar) {
  const canvas = h('canvas', { role: 'img', 'aria-label': descricao });
  const caixa = h('div', { class: 'grafico-mini' }, canvas);
  return { caixa, canvas, criar };
}

function botoes(lista) {
  return h('div', { class: 'acoes pequeno' }, lista.map(([texto, aoClicar, primario]) =>
    h('button', { class: primario ? 'btn btn-primario' : 'btn', type: 'button', onclick: aoClicar }, texto)));
}

// ---------- o que pede atenção ----------
function fotoDaPatologia(foto) {
  const caixa = h('figure', { class: 'foto-patologia' });
  const caixaDeFalha = () => h('div', { class: 'foto-falhou mudo', role: 'img', 'aria-label': 'Foto ilustrativa indisponível' },
    `A foto ilustrativa não carregou (${foto.arquivo}).`);
  const img = h('img', {
    src: foto.arquivo, alt: foto.legenda, loading: 'lazy',
    onerror: () => {
      console.error(`Painel: a foto ilustrativa da patologia não carregou (${foto.arquivo}).`);
      img.replaceWith(caixaDeFalha());
    },
  });
  // O endereço vem do arquivo de dados; só vira link se for https.
  const credito = typeof foto.endereco === 'string' && foto.endereco.startsWith('https://')
    ? h('a', { href: foto.endereco, target: '_blank', rel: 'noopener' }, foto.fonte)
    : foto.fonte;
  caixa.append(
    img,
    h('span', { class: 'selo selo-ficticio foto-selo' }, 'foto ilustrativa'),
    h('figcaption', {}, foto.legenda, ' ', `Foto: ${foto.autor}, ${foto.licenca}, `, credito, '.'));
  return caixa;
}

function pedeAtencao(dados, acoes, controle, registrar) {
  const secao = h('section', { class: 'sala-atencao' }, h('h2', { class: 'sala-titulo' }, 'Pede atenção ', seloFicticio()));
  if (!dados.ficticio.ok) {
    secao.append(erroDeArquivo(dados.ficticio, 'dados/gemeo_ficticio.json', 'Não consegui carregar a patologia e os sensores.'));
    return secao;
  }
  const { patologia: p, sensor: s, sensor_rio: r } = dados.ficticio.dado;
  const ativoSensor = dados.ativos.ok ? dados.ativos.dado.ativos[s.id_ativo] : null;
  const estS = estadoDoSensor(s);

  function linha({ chave, cor, titulo, texto, montar }) {
    const id = novoId('atencao');
    const corpo = h('div', { class: 'linha-corpo', id, hidden: true });
    const l = { chave, corpo, montar, aberta: false, grafico: null };
    l.cab = h('button', {
      class: 'linha-cab atencao-cab', type: 'button', 'aria-expanded': 'false', 'aria-controls': id,
      onclick: () => controle.alternar(l),
    },
    h('span', { class: 'atencao-titulo' }, titulo),
    h('span', { class: 'atencao-texto' }, texto),
    h('span', { class: 'linha-seta', 'aria-hidden': 'true' }, '›'));
    l.el = h('li', { class: 'atencao-linha', estilo: { '--cor': cor } }, l.cab, corpo);
    return l;
  }

  const linhas = [
    linha({
      chave: 'patologia',
      cor: corNoEscuro(COR_CONDICAO[p.gravidade] || COR_CONDICAO.Ruim),
      titulo: `${p.titulo} no ${p.id_ativo}`,
      texto: `Condição ${p.gravidade}. ${p.descricao} ${p.ordem_servico}, prazo ${dataBR(p.prazo)}.`,
      montar: () => ({
        nos: [
          p.foto_ilustrativa ? fotoDaPatologia(p.foto_ilustrativa) : null,
          botoes([
            ['Abrir a ficha', () => acoes.abrirFicha({ tipo: 'ativo', id: p.id_ativo }), true],
            ['Ver no mapa', () => acoes.verMarcador('patologia', 'mapa')],
          ]),
        ].filter(Boolean),
        grafico: null,
      }),
    }),
    linha({
      chave: 'sensor',
      cor: estS.cor,
      titulo: `Talude de corte, sensor ${s.id}: ${estS.nome.toLowerCase()}`,
      texto: fraseDoSensor(s, ativoSensor),
      montar: () => {
        const g = caixaDeGrafico(descricaoDoGrafico(s), (c) => criarGraficoSensor(c, s, { mini: true }));
        return {
          nos: [g.caixa, botoes([
            ['Abrir a ficha', () => acoes.abrirFicha({ tipo: 'ativo', id: s.id_ativo }), true],
            ['Ver no mapa', () => acoes.verMarcador('sensor', 'mapa')],
          ])],
          grafico: g,
        };
      },
    }),
  ];
  if (r) {
    const estR = estadoDoRio(r);
    const fora = estR.periodoFora;
    linhas.push(linha({
      chave: 'rio',
      cor: corNoEscuro(estR.cor),
      titulo: `Rio sob a ponte, medidor ${r.id}: ${estR.nome.toLowerCase()}`,
      texto: `${fmtM(estR.ultima.altura_livre_m)} de altura livre sob as vigas e ${fmtVazao(estR.ultima.vazao_m3s)} em ${dataBR(estR.ultima.data)}.`
        + (fora ? ` Passou do limite de atenção de ${dataCurta(fora.de)} a ${dataCurta(fora.ate)}, com a menor, ${fmtM(estR.menor.altura_livre_m)}, em ${dataCurta(estR.menor.data)}.` : ''),
      montar: () => {
        const g = caixaDeGrafico(descricaoDoGraficoRio(r), (c) => criarGraficoRio(c, r, { mini: true }));
        return {
          nos: [g.caixa, botoes([
            ['Abrir a ficha da ponte', () => acoes.abrirPonte(), true],
            ['Ver no mapa', () => acoes.verMarcador('rio', 'mapa')],
          ])],
          grafico: g,
        };
      },
    }));
  }
  // As linhas do talude e do rio daqui abrem e voam como as da lista de sensores, mas o rótulo do 3D
  // (escolher) é registrado na lista de sensores; só a patologia, que não tem sensor, é registrada aqui.
  registrar('patologia', linhas[0]);
  const lista = h('ul', { class: 'atencao-lista' }, linhas.map((l) => l.el));
  secao.append(lista);

  // O que a banca cadastra pelo link com condição Ruim ou Crítica entra aqui, acima do fictício: é o
  // que acabou de acontecer. A lista do banco chega depois do Painel montado, e cresce a cada gravação.
  if (acoes.cadastro) {
    let doLink = [];
    acoes.cadastro.aoMudar((todas) => {
      doLink.forEach((l) => { if (l.aberta) controle.voltarParaPonte(); l.el.remove(); registrar(l.chave, null); });
      doLink = todas.filter((c) => c.condicao === 'Ruim' || c.condicao === 'Crítica').map((c) => {
        const onde = c.id_ativo === 'OAE-01' ? 'na ponte' : `no ${c.id_ativo}`;
        const quando = c.data_executada ? `Executada em ${dataBR(c.data_executada)}` : `Planejada para ${dataBR(c.data_planejada)}`;
        // O título da seção leva FICTÍCIO; sem o selo azul na própria linha, a inspeção que a banca
        // gravou de verdade era lida como parte do inventado (visto no primeiro envio, 02/11/2026).
        const l = linha({
          chave: `cad-${c.id}`,
          cor: corNoEscuro(COR_CONDICAO[c.condicao]),
          titulo: [`Inspeção ${onde}: ${c.condicao.toLowerCase()} `, seloLink()],
          texto: [c.nao_conformidade, `${quando}${c.decisao ? `, decisão: ${c.decisao}` : ''}.`].filter(Boolean).join(' '),
          montar: () => ({
            nos: [
              listaDoLink([c], { comSelo: false, cadastro: acoes.cadastro }),
              botoes([
                ['Abrir a ficha', () => acoes.abrirFicha(c.id_ativo === 'OAE-01' ? { tipo: 'ponte' } : { tipo: 'ativo', id: c.id_ativo }), true],
                ['Ver no mapa', () => acoes.verMarcador(`cad-${c.id}`, 'mapa')],
              ]),
            ],
            grafico: null,
          }),
        });
        registrar(l.chave, l);
        return l;
      });
      lista.prepend(...doLink.map((l) => l.el));
    });
  }
  return secao;
}

// ---------- datas ----------
// As datas vêm em ISO e a conta é em dias inteiros, pelo mesmo motivo do dataBR: evitar o fuso do new Date().
function diasEntre(isoA, isoB) {
  const d = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((d(isoB) - d(isoA)) / 86400000);
}
function quandoFalta(hoje, iso) {
  const dias = diasEntre(hoje, iso);
  if (dias < 0) return 'vencida';
  if (dias === 0) return 'hoje';
  if (dias < 60) return `em ${dias} dias`;
  const meses = Math.round(dias / 30.44);
  if (meses < 24) return `em ${meses} meses`;
  return `em ${Math.floor(dias / 365.25)} anos`;
}

function juntarAtividades(lista) {
  const nomes = [...new Set(lista)].sort();
  if (nomes.length < 2) return nomes.join('');
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1].toLowerCase()}`;
}

// ---------- agenda ----------
// Um só DOM serve aos dois tamanhos: o CSS faz dele o trilho horizontal no computador e a lista
// vertical no celular.
function eventosDaAgenda(fic) {
  const eventos = [];
  if (fic.patologia) {
    eventos.push({ data: fic.patologia.prazo, oque: `Prazo da ${fic.patologia.ordem_servico}: reparo no ${fic.patologia.id_ativo}`, quanto: '1 peça', cor: COR_CONDICAO[fic.patologia.gravidade] });
  }
  if (fic.ponte && fic.ponte.proxima) {
    eventos.push({ data: fic.ponte.proxima.data_planejada, oque: `Ponte: ${fic.ponte.proxima.atividade.toLowerCase()}`, quanto: fic.ponte.id });
  }
  // As 55 planejadas caem em poucas datas, porque o intervalo do COBie é contado da mesma situação
  // simulada para todas: em 02/11/2026 deram três (7, 16 e 32 peças).
  const porData = new Map();
  (fic.proximas_inspecoes || []).forEach((i) => {
    if (!porData.has(i.data_planejada)) porData.set(i.data_planejada, []);
    porData.get(i.data_planejada).push(i);
  });
  porData.forEach((lista, data) => {
    eventos.push({ data, oque: juntarAtividades(lista.map((i) => i.atividade)), quanto: `${fmtNum(lista.length)} ${lista.length === 1 ? 'peça' : 'peças'}` });
  });
  return eventos.sort((a, b) => a.data.localeCompare(b.data));
}

function resumoDaAgenda(hoje, eventos) {
  if (!eventos.length) return 'nenhuma planejada';
  const quando = quandoFalta(hoje, eventos[0].data);
  if (quando === 'vencida') return 'a próxima está vencida';
  if (quando === 'hoje') return 'a próxima é hoje';
  return `a próxima ${quando}`;
}

function conteudoDaAgenda(fic, eventos) {
  if (!eventos.length) return h('p', { class: 'mudo' }, 'Nenhuma inspeção planejada.');
  return [
    h('ol', { class: 'agenda', estilo: { '--n': eventos.length } }, eventos.map((e) => h('li', { class: 'marco', estilo: e.cor ? { '--cor': corNoEscuro(e.cor) } : null },
      h('div', { class: 'marco-data' },
        h('time', { datetime: e.data }, dataBR(e.data)),
        h('span', { class: 'marco-quando' }, quandoFalta(fic.data_simulada, e.data))),
      h('div', { class: 'marco-texto' },
        h('span', { class: 'marco-oque' }, e.oque),
        h('span', { class: 'marco-quanto' }, e.quanto))))),
    h('p', { class: 'mudo nota' }, `Contadas de ${dataBR(fic.data_simulada)} pelo menor intervalo de manutenção do COBie de cada peça.`),
  ];
}

// ---------- sensores ----------
function partirValor(texto, extra) {
  const i = texto.indexOf(' ');
  const numero = i < 0 ? texto : texto.slice(0, i);
  const unidade = i < 0 ? '' : texto.slice(i + 1);
  return { numero, unidade: [unidade, extra].filter(Boolean).join(' ') };
}

// A curva mínima da linha do sensor: sem eixo, de ponta a ponta, esticada pela largura com
// `preserveAspectRatio="none"` e traço de espessura fixa (non-scaling-stroke). O limite de atenção só
// entra na faixa quando está perto dos dados (até 1,5× a amplitude deles, fora do intervalo): no ACL-01
// os dados variam 0,043 Hz (3,093 a 3,136) e o limite fica a 0,133 Hz, e puxar a faixa até ele
// deixaria a curva reta, que é justamente o que se quer evitar. No JUN-01, 6,6 mm contra 5,3 mm de
// amplitude, o limite entra.
function curvaMinima(valores, cor, limite) {
  const L = 300;
  const A = 20;
  const lo = Math.min(...valores);
  const hi = Math.max(...valores);
  const distancia = limite == null ? Infinity : (limite < lo ? lo - limite : limite > hi ? limite - hi : 0);
  const perto = distancia <= 1.5 * (hi - lo);
  const min = perto ? Math.min(lo, limite) : lo;
  const max = perto ? Math.max(hi, limite) : hi;
  const Y = (v) => (1 - (v - min) / ((max - min) || 1)) * (A - 4) + 2;
  const no = (tag, attrs) => {
    const el = document.createElementNS(SVG, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    return el;
  };
  const svg = no('svg', { class: 'curva', viewBox: `0 0 ${L} ${A}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
  if (perto) {
    svg.append(no('line', {
      x1: 0, x2: L, y1: Y(limite), y2: Y(limite), stroke: NIVEL_AMBAR, 'stroke-width': 1, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke',
    }));
  }
  svg.append(no('polyline', {
    points: valores.map((v, i) => `${((i / (valores.length - 1)) * L).toFixed(1)},${Y(v).toFixed(1)}`).join(' '),
    fill: 'none', stroke: cor, 'stroke-width': 1.6, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke',
  }));
  return svg;
}

function definirSensores(fic, acoes) {
  const defs = [];
  const r = fic.sensor_rio;
  if (r) {
    const est = estadoDoRio(r);
    defs.push({
      chave: 'rio', grupo: 'ponte', id: r.id, sub: 'rio sob a ponte, altura livre',
      estado: est, valor: partirValor(fmtM(est.ultima.altura_livre_m), 'livres'),
      serie: r.leituras.map((l) => l.altura_livre_m), limite: r.limite_atencao_m,
      mede: r.mede, limites: `Limite de atenção ${fmtM(r.limite_atencao_m)} · alerta ${fmtM(r.limite_alerta_m)} de altura livre`,
      bateria: r.bateria_pct, transmissao: r.ultima_transmissao,
      descricao: () => descricaoDoGraficoRio(r), criar: (c) => criarGraficoRio(c, r, { mini: true }),
      ficha: ['Abrir a ficha da ponte', () => acoes.abrirPonte()],
    });
  }
  (Array.isArray(fic.sensores_ponte) ? fic.sensores_ponte : []).forEach((s) => {
    const est = estadoDoSensorPonte(s);
    const formato = (v) => `${fmtDec(v, 0, s.casas)} ${s.unidade}`;
    defs.push({
      chave: s.id, grupo: 'ponte', id: s.id, sub: s.nome,
      estado: est, valor: partirValor(fmtValorSensor(s, est.valor)),
      serie: s.leituras.map((l) => l.valor), limite: s.limite_atencao,
      mede: s.mede,
      limites: `Limite de atenção ${formato(s.limite_atencao)} · alerta ${formato(s.limite_alerta)}${s.sentido === 'abaixo' ? ' (valem quando a leitura fica abaixo)' : ''}`,
      bateria: s.bateria_pct, transmissao: s.ultima_transmissao,
      descricao: () => descricaoDoGraficoPonte(s), criar: (c) => criarGraficoPonte(c, s, { mini: true }),
      ficha: ['Abrir a ficha da ponte', () => acoes.abrirPonte()],
    });
  });
  const t = fic.sensor;
  if (t) {
    const est = estadoDoSensor(t);
    defs.push({
      chave: 'sensor', grupo: 'talude', id: t.id, sub: 'talude de corte, deslocamento',
      estado: est, valor: partirValor(fmtMm(est.mm)),
      serie: t.leituras.map((l) => l.deslocamento_mm), limite: t.limite_atencao_mm,
      mede: t.mede, limites: `Limite de atenção ${fmtDec(t.limite_atencao_mm, 0, 2)} mm · alerta ${fmtDec(t.limite_alerta_mm, 0, 2)} mm`,
      bateria: t.bateria_pct, transmissao: t.ultima_transmissao,
      descricao: () => descricaoDoGrafico(t), criar: (c) => criarGraficoSensor(c, t, { mini: true }),
      ficha: ['Abrir a ficha', () => acoes.abrirFicha({ tipo: 'ativo', id: t.id_ativo })],
    });
  }
  return defs;
}

function resumoDosSensores(defs) {
  const conta = (nome) => defs.filter((d) => d.estado.nome === nome).length;
  const frases = [];
  [['Atenção', 'atenção'], ['Alerta', 'alerta']].forEach(([nome, texto]) => {
    const n = conta(nome);
    if (n) frases.push(`${n === 1 ? 'um' : fmtNum(n)} em ${texto}`);
  });
  return `${fmtNum(defs.length)}, ${frases.length ? frases.join(' e ') : 'todos normais'}`;
}

function linhaDeSensor(def, controle) {
  const id = novoId('sensor');
  const cor = corNoEscuro(def.estado.cor);
  const corpo = h('div', { class: 'linha-corpo sensor-corpo', id, hidden: true });
  const l = {
    chave: def.chave, corpo, aberta: false, grafico: null,
    montar: () => {
      const g = caixaDeGrafico(def.descricao(), def.criar);
      return {
        nos: [
          g.caixa,
          h('p', { class: 'linha-mede' }, `Mede ${def.mede}.`),
          h('p', { class: 'linha-meta' }, def.limites),
          h('p', { class: 'linha-meta' }, `Bateria ${def.bateria}% · última transmissão ${dataHoraBR(def.transmissao)}`),
          botoes([[def.ficha[0], def.ficha[1], true]]),
        ],
        grafico: g,
      };
    },
  };
  l.cab = h('button', {
    class: 'linha-cab sensor-cab', type: 'button', 'aria-expanded': 'false', 'aria-controls': id,
    onclick: () => controle.alternar(l),
  },
  h('span', { class: 'sensor-id' }, h('b', {}, def.id), h('span', { class: 'sensor-sub' }, def.sub)),
  h('span', { class: 'sensor-valor', estilo: { color: cor } }, def.valor.numero, ' ', h('small', {}, def.valor.unidade)),
  curvaMinima(def.serie, cor, def.limite));
  l.el = h('li', { class: 'sensor' }, l.cab, corpo);
  return l;
}

// ---------- os blocos que dobram ----------
function dobra({ classe, titulo, selos = [], resumo, conteudo, fixa = false }) {
  const d = h('details', { class: `dobra ${classe}${fixa ? ' dobra-fixa' : ''}` },
    h('summary', {
      // No computador as dobras "fixas" são só títulos de uma coluna: o clique não pode fechá-las.
      onclick: (ev) => { if (fixa && largo.matches) ev.preventDefault(); },
    },
    h('span', { class: 'dobra-titulo' }, titulo, ' ', selos),
    resumo ? h('span', { class: 'dobra-resumo' }, resumo) : null,
    h('span', { class: 'dobra-seta', 'aria-hidden': 'true' }, '›')),
    h('div', { class: 'dobra-corpo' }, conteudo));
  return d;
}

function dobraDeErro(classe, titulo, erro, fixa = false) {
  return dobra({ classe, titulo, conteudo: erro, fixa });
}

function dobraDoHistorico(dados) {
  if (!dados.ficticio.ok) {
    return dobraDeErro('dobra-historico', 'Histórico do bueiro', erroDeArquivo(dados.ficticio, 'dados/gemeo_ficticio.json', 'Não consegui carregar as inspeções.'));
  }
  const { inspecoes } = dados.ficticio.dado;
  const id = inspecoes.length ? inspecoes[0].id_ativo : 'BUEIRO_001';
  return dobra({
    classe: 'dobra-historico', titulo: `Histórico do ${id}`, selos: [seloFicticio()],
    resumo: `${fmtNum(inspecoes.length)} ${inspecoes.length === 1 ? 'inspeção' : 'inspeções'}`,
    conteudo: inspecoes.length ? listaDeInspecoes(inspecoes) : h('p', { class: 'mudo' }, 'Nenhuma inspeção registrada.'),
  });
}

function contagem(ativos, campo, rotulo, corDe) {
  const mapa = new Map();
  Object.values(ativos).forEach((a) => mapa.set(a[campo], (mapa.get(a[campo]) || 0) + 1));
  const linhas = [...mapa.entries()].sort((x, y) => y[1] - x[1]);
  const maior = linhas[0][1];
  return h('div', { class: 'barras' },
    linhas.map(([nome, n]) => h('div', { class: 'barra-linha' },
      h('span', { class: 'barra-nome', title: nome }, rotulo(nome)),
      h('span', { class: 'barra-trilho' }, h('span', { class: 'barra-cheia', estilo: { width: `${(n / maior) * 100}%`, background: corDe(nome) } })),
      h('span', { class: 'barra-valor' }, fmtNum(n)))));
}

function dobraDosAtivos(dados) {
  if (!dados.ativos.ok) {
    return dobraDeErro('dobra-ativos', 'Ativos do AIM', erroDeArquivo(dados.ativos, 'dados/ativos.json', 'Não consegui carregar os ativos.'));
  }
  const a = dados.ativos.dado;
  const n = Object.keys(a.ativos).length;
  return dobra({
    classe: 'dobra-ativos', titulo: 'Ativos do AIM', selos: [seloModelo()], resumo: fmtNum(n),
    conteudo: [
      h('p', { class: 'mudo' }, `${fmtNum(n)} ativos no AIM e ${fmtNum(Object.keys(a.guid_para_ativo).length)} componentes IFC ligados a eles.`),
      h('h3', { class: 'dobra-subtitulo' }, 'Por tipo'),
      contagem(a.ativos, 'tipo', rotuloTipo, corDoTipo),
      h('h3', { class: 'dobra-subtitulo' }, 'Por disciplina'),
      contagem(a.ativos, 'disciplina', (nome) => nome, () => COR_RIO_NO_ESCURO),
    ],
  });
}

// ---------- a janela do 3D ----------
function janelaDoModelo(dados, acoes, controle) {
  const slot3d = h('div', { class: 'slot3d' });
  const fic = dados.ficticio.ok ? dados.ficticio.dado : null;
  const op = fic ? fic.ponte : null;

  let detalhe;
  if (dados.ponte.ok) {
    const p = dados.ponte.dado;
    const vaosIguais = p.vaos_m.every((v) => v === p.vaos_m[0]);
    detalhe = [
      `${fmtM(p.comprimento_tabuleiro_m)} · ${p.vaos_m.length} vãos${vaosIguais ? ` de ${fmtM(p.vaos_m[0])}` : ''}`,
      op ? `condição ${op.condicao}` : null,
    ].filter(Boolean).join(' · ');
  } else {
    console.error('Painel: dados/ponte.json não carregou, a janela do 3D fica sem as medidas da ponte.', dados.ponte.erro);
    detalhe = 'as medidas da ponte não carregaram (dados/ponte.json)';
  }
  const aberturaPonte = h('button', {
    class: 'ponte-info', type: 'button', onclick: () => acoes.abrirPonte(),
    'aria-label': `Abrir a ficha da ponte${op ? ` ${op.id}` : ''}. ${detalhe}`,
  }, h('b', {}, op ? `Ponte ${op.id}` : 'Ponte'), h('span', {}, detalhe));

  const voltar = h('button', {
    class: 'btn btn-sobre-3d btn-voltar', type: 'button', hidden: true, onclick: () => controle.voltarParaPonte(),
  }, 'Voltar à ponte');

  const dica = h('p', { class: 'dica-3d' },
    h('span', { class: 'so-mouse' }, 'arraste para girar'),
    h('span', { class: 'so-toque' }, 'um dedo gira'));

  const janela = h('div', { class: 'janela3d' }, slot3d, aberturaPonte, voltar, dica);
  return {
    janela, slot3d,
    marcarVoo(emVoo) {
      voltar.hidden = !emVoo;
      janela.classList.toggle('em-voo', emVoo);
    },
  };
}

export function montarPainel(raiz, dados, acoes) {
  const linhasPorChave = new Map();
  let marcarVoo = () => {};
  const controle = criarControleDeLinhas(acoes, (aberta) => marcarVoo(Boolean(aberta)));
  const registrar = (chave, linha) => {
    if (!chave) return;
    if (linha) linhasPorChave.set(chave, linha);
    else linhasPorChave.delete(chave);
  };

  const modelo = janelaDoModelo(dados, acoes, controle);
  marcarVoo = modelo.marcarVoo;

  // A agenda e os sensores dependem do gemeo_ficticio.json; sem ele cada bloco mostra a própria caixa de erro.
  let dobraAgenda;
  let dobraSensores;
  if (dados.ficticio.ok) {
    const fic = dados.ficticio.dado;
    const eventos = eventosDaAgenda(fic);
    dobraAgenda = dobra({
      classe: 'dobra-agenda', titulo: 'Próximas inspeções', selos: [seloFicticio()], fixa: true,
      resumo: resumoDaAgenda(fic.data_simulada, eventos), conteudo: conteudoDaAgenda(fic, eventos),
    });

    const defs = definirSensores(fic, acoes);
    const linhasDeSensor = defs.map((d) => linhaDeSensor(d, controle));
    linhasDeSensor.forEach((l) => registrar(l.chave, l));
    // O data-grupo dá ao título a mesma cor do rótulo do grupo no 3D (estilo.css, --grupo-*).
    const grupo = (chave, nome, itens) => (itens.length ? [h('h3', { class: 'sensores-grupo', 'data-grupo': chave }, nome), h('ul', { class: 'sensores-lista' }, itens.map((l) => l.el))] : []);
    dobraSensores = dobra({
      classe: 'dobra-sensores', titulo: 'Sensores', selos: [seloFicticio()], fixa: true,
      resumo: resumoDosSensores(defs),
      conteudo: [
        ...grupo('ponte', 'Na ponte', linhasDeSensor.filter((l, i) => defs[i].grupo === 'ponte')),
        ...grupo('talude', 'No talude de corte', linhasDeSensor.filter((l, i) => defs[i].grupo === 'talude')),
      ],
    });
  } else {
    const caixa = () => erroDeArquivo(dados.ficticio, 'dados/gemeo_ficticio.json', 'Não consegui carregar os sensores e a agenda.');
    dobraAgenda = dobraDeErro('dobra-agenda', 'Próximas inspeções', caixa(), true);
    dobraSensores = dobraDeErro('dobra-sensores', 'Sensores', caixa(), true);
  }

  const esquerda = h('div', { class: 'sala-esq' },
    condicaoGeral(dados),
    pedeAtencao(dados, acoes, controle, registrar),
    dobraDoHistorico(dados),
    dobraDosAtivos(dados));
  const meio = h('div', { class: 'sala-meio' }, modelo.janela, dobraAgenda);
  const direita = h('div', { class: 'sala-dir' }, dobraSensores);

  // No computador essas duas dobras são colunas e ficam sempre abertas; no celular começam fechadas.
  const fixas = [dobraAgenda, dobraSensores];
  const ajustarFixas = () => fixas.forEach((d) => {
    d.open = largo.matches;
    // Título de coluna no computador: não precisa de parada no Tab.
    d.querySelector('summary').tabIndex = largo.matches ? -1 : 0;
  });
  ajustarFixas();
  largo.addEventListener('change', ajustarFixas);

  raiz.replaceChildren(h('div', { class: 'painel' }, esquerda, meio, direita));

  return {
    slot3d: modelo.slot3d,
    /**
     * O app chama quando alguém toca num rótulo do 3D: o mesmo que tocar na linha correspondente.
     * Devolve false quando não há linha, e aí o app abre a ficha: é o caso esperado da inspeção do link
     * em condição Boa ou Regular, que não pede atenção.
     */
    escolher(chave) {
      const l = linhasPorChave.get(chave);
      if (!l) {
        if (!chave.startsWith('cad-')) {
          console.error(`Painel: o rótulo "${chave}" do 3D não tem linha correspondente (esperado: patologia, sensor, rio, EROS-01, JUN-01, ACL-01 ou cad-<id>).`);
        }
        return false;
      }
      // No celular a lista de sensores pode estar fechada; a linha só pode abrir se a dobra dela estiver aberta.
      const dobraDaLinha = l.el.closest('details');
      if (dobraDaLinha && !dobraDaLinha.open) dobraDaLinha.open = true;
      controle.abrir(l);
      l.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return true;
    },
  };
}
