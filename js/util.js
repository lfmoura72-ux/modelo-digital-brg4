// Utilidades compartilhadas: montagem de DOM, formatação pt-BR, paleta e caixas de erro.
// Nada aqui depende de Leaflet, three ou Chart.js, para poder ser importado por qualquer vista.

export const CORES = {
  navy: '#092B49', azul: '#1C71B5', verde: '#4CA355', cinza: '#53687A',
  borda: '#D3DEE6', fundo: '#F4F7FA', tAzul: '#EBF2F7', tVerde: '#EDF7EF',
};

// Ordem de baixo para cima na pilha do pavimento (o desenho e a ordem das camadas no mapa seguem esta lista).
export const ORDEM_TIPOS = [
  'Sub-base', 'Base', 'Camada de binder', 'Talude de aterro', 'Talude de corte',
  'Superficie TIN', 'Camada de superfície',
];

export const CORES_TIPO = {
  'Camada de superfície': '#3A3F45',
  'Camada de binder': '#5B6168',
  'Base': '#A07850',
  'Sub-base': '#C9A66B',
  'Talude de corte': '#B5835A',
  'Talude de aterro': '#9C7B4F',
  'Superficie TIN': '#4CA355',
  'Tubo de drenagem': '#1C71B5',
  'Boca de bueiro': '#1C71B5',
  'Dissipador de energia': '#0E4F80',
};
export const COR_CONCRETO = '#B8BCC2';
export const COR_TERRENO = '#8DBF7F';

export const COR_CONDICAO = { Boa: '#4CA355', Regular: '#E0A100', Ruim: '#E06A1B', 'Crítica': '#C62828' };
export const COR_SENSOR = { 'Atenção': '#E0A100', Alerta: '#C62828', Normal: '#4CA355' };

// "Superficie TIN" é o nome do tipo no modelo; na tela o dono fala em revestimento vegetal.
export function rotuloTipo(tipo) {
  return tipo === 'Superficie TIN' ? 'Revestimento vegetal' : tipo;
}
export function corDoTipo(tipo) {
  return CORES_TIPO[tipo] || CORES.cinza;
}

/** Monta um elemento sem usar innerHTML (os dados vêm de arquivo e nunca devem virar HTML). */
export function h(tag, props = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props || {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (chave === 'class') el.className = valor;
    else if (chave === 'texto') el.textContent = valor;
    // Propriedades personalizadas (--cor) não funcionam por atribuição direta em style; precisam de setProperty.
    else if (chave === 'estilo') {
      for (const [prop, v] of Object.entries(valor)) {
        el.style.setProperty(prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), v);
      }
    }
    else if (chave.startsWith('on') && typeof valor === 'function') el.addEventListener(chave.slice(2), valor);
    else el.setAttribute(chave, valor === true ? '' : String(valor));
  }
  for (const f of filhos.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f.nodeType ? f : document.createTextNode(String(f)));
  }
  return el;
}

const fmtInteiro = new Intl.NumberFormat('pt-BR');
export const fmtNum = (v) => fmtInteiro.format(v);
export function fmtDec(v, min = 0, max = 2) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });
}
export const fmtMm = (v) => `${fmtDec(v, 1, 2)} mm`;
export const fmtArea = (v) => `${fmtDec(v, 0, 1)} m²`;
export const fmtReais = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// As datas do JSON são ISO ("2027-09-20"). Separar o texto evita o deslocamento de fuso do new Date().
export function dataBR(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
export function dataCurta(iso) {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}
export function dataHoraBR(iso) {
  if (!iso) return '';
  const hora = iso.length > 10 ? ` ${iso.slice(11, 16)}` : '';
  return dataBR(iso) + hora;
}
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const mesPorExtenso = (iso) => MESES[Number(iso.slice(5, 7)) - 1];

export const seloFicticio = () => h('span', { class: 'selo selo-ficticio', title: 'Dado inventado para a demonstração' }, 'FICTÍCIO');
export const seloModelo = () => h('span', { class: 'selo selo-modelo', title: 'Vem do modelo real (IFC + COBie)' }, 'do modelo');
// Dado medido fora do projeto (a série da ANA): nem "do modelo" nem fictício, e a banca precisa ver a diferença.
export const seloReal = (fonte) => h('span', { class: 'selo selo-real', title: `Dado real, medido pela ${fonte}` }, `dado real · ${fonte}`);

export function pilula(texto, cor) {
  return h('span', { class: 'pilula', estilo: { '--cor': cor } }, texto);
}

/** Estado do sensor a partir da última leitura e dos limites. */
export function estadoDoSensor(sensor) {
  const ultima = sensor.leituras[sensor.leituras.length - 1];
  const mm = ultima.deslocamento_mm;
  let nome = 'Normal';
  if (mm >= sensor.limite_alerta_mm) nome = 'Alerta';
  else if (mm >= sensor.limite_atencao_mm) nome = 'Atenção';
  return { nome, cor: COR_SENSOR[nome], mm, data: ultima.data };
}

// O medidor do rio é o contrário do inclinômetro: o perigo é a altura livre DIMINUIR
// (a água subindo até a viga), então o limite vale quando a leitura fica abaixo dele.
export const COR_RIO = '#1C71B5';
export const fmtM = (v) => `${fmtDec(v, 2, 2)} m`;
export const fmtVazao = (v) => `${fmtDec(v, 1, 1)} m³/s`;

export function estadoDaLeituraDoRio(medidor, leitura) {
  if (leitura.altura_livre_m <= medidor.limite_alerta_m) return 'Alerta';
  if (leitura.altura_livre_m <= medidor.limite_atencao_m) return 'Atenção';
  return 'Normal';
}

/** Estado do HID-01 pela última leitura, e o período em que ele passou do limite de atenção. */
export function estadoDoRio(medidor) {
  const l = medidor.leituras;
  const ultima = l[l.length - 1];
  const nome = estadoDaLeituraDoRio(medidor, ultima);
  const fora = l.filter((x) => estadoDaLeituraDoRio(medidor, x) !== 'Normal');
  const menor = l.reduce((a, b) => (b.altura_livre_m < a.altura_livre_m ? b : a));
  return {
    nome, cor: nome === 'Normal' ? COR_RIO : COR_SENSOR[nome], ultima, menor,
    periodoFora: fora.length ? { de: fora[0].data, ate: fora[fora.length - 1].data, semanas: fora.length } : null,
  };
}

// Os sensores da estrutura da ponte (EROS-01, JUN-01, ACL-01) têm um formato só: `valor` em cada
// leitura, a `unidade`, as `casas` decimais e o `sentido` do perigo. "acima": o limite vale quando a
// leitura sobe até ele (a erosão); "abaixo": quando desce (a junta fechando, a frequência caindo).
export function estadoDoSensorPonte(sensor) {
  const ultima = sensor.leituras[sensor.leituras.length - 1];
  const passou = (limite) => (sensor.sentido === 'abaixo' ? ultima.valor <= limite : ultima.valor >= limite);
  let nome = 'Normal';
  if (passou(sensor.limite_alerta)) nome = 'Alerta';
  else if (passou(sensor.limite_atencao)) nome = 'Atenção';
  return { nome, cor: COR_SENSOR[nome], valor: ultima.valor, data: ultima.data, ultima };
}
export const fmtValorSensor = (sensor, valor) => `${fmtDec(valor, sensor.casas, sensor.casas)} ${sensor.unidade}`;

/** Frase corrida sobre o sensor (usada no Painel). */
export function fraseDoSensor(sensor, ativo) {
  const est = estadoDoSensor(sensor);
  const alvo = ativo ? ativo.tipo.toLowerCase() : 'ativo monitorado';
  const desde = mesPorExtenso(sensor.leituras[0].data);
  const lim = `limite de atenção (${fmtDec(sensor.limite_atencao_mm, 0, 2)} mm)`;
  const lima = `limite de alerta (${fmtDec(sensor.limite_alerta_mm, 0, 2)} mm)`;
  let comparacao;
  if (est.nome === 'Alerta') comparacao = `acima do ${lima}`;
  else if (est.nome === 'Atenção') comparacao = `acima do ${lim}, abaixo do de alerta (${fmtDec(sensor.limite_alerta_mm, 0, 2)} mm)`;
  else comparacao = `abaixo do ${lim}`;
  return `O ${alvo} se moveu ${fmtMm(est.mm)} desde ${desde}: ${comparacao}.`;
}

/** Caixa de erro em português, nunca uma tela em branco. */
export function caixaErro({ titulo, arquivo, detalhe, dica, aoTentar }) {
  return h('div', { class: 'caixa-erro', role: 'alert' },
    h('strong', {}, titulo),
    arquivo ? h('p', {}, 'Arquivo: ', h('code', {}, arquivo)) : null,
    detalhe ? h('p', {}, detalhe) : null,
    dica ? h('p', { class: 'dica' }, dica) : null,
    aoTentar ? h('button', { class: 'btn', type: 'button', onclick: aoTentar }, 'Tentar de novo') : null);
}
