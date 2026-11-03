// Gráficos dos sensores fictícios: o INC-01 do talude, o HID-01 do rio e os três da estrutura da
// ponte (Chart.js, carregado como global pelo index.html). Tema escuro, como a página toda.
import {
  COR_SENSOR, COR_RIO, COR_CONDICAO, dataBR, dataCurta, fmtDec, fmtMm, fmtM, fmtVazao, fmtValorSensor,
  estadoDoSensorPonte,
} from './util.js';

const TEMA = {
  linha: '#5AB0F0',          // linha principal: o azul do acento da página
  verde: '#4CA355',
  barras: 'rgba(90, 176, 240, .28)',
  barrasTemperatura: 'rgba(141, 155, 168, .30)',
  tick: '#8D9BA8',
  legenda: '#B5C1CC',
  grade: '#1F2C38',
  tooltipFundo: '#0B131B',
  tooltipBorda: '#2D3E4E',
  tooltipTitulo: '#E4EAF0',
};

// O vermelho do alerta (#C62828) e o azul do rio (#1C71B5) são escuros demais sobre o fundo #0F1923
// (o vermelho dá ~3,2:1 de contraste, e o texto pequeno precisa de mais); no tema escuro usam-se
// versões mais claras do mesmo matiz. Quem desenha texto ou linha na página usa esta função.
const CLAREADAS = new Map([
  [COR_SENSOR.Alerta.toLowerCase(), '#F0605D'],
  [COR_RIO.toLowerCase(), '#2E8BE0'],
  [COR_CONDICAO['Crítica'].toLowerCase(), '#F0605D'],
]);
export function corNoEscuro(cor) {
  return CLAREADAS.get(String(cor).toLowerCase()) || cor;
}

// Ajusta os padrões do Chart.js uma vez, antes de qualquer gráfico nascer.
if (window.Chart) {
  window.Chart.defaults.color = TEMA.tick;
  window.Chart.defaults.borderColor = TEMA.grade;
}

const tooltipEscuro = {
  backgroundColor: TEMA.tooltipFundo, borderColor: TEMA.tooltipBorda, borderWidth: 1,
  titleColor: TEMA.tooltipTitulo, bodyColor: TEMA.legenda, padding: 8, displayColors: true,
};
const legendaEscura = (mini, extra = {}) => ({
  display: !mini, position: 'bottom',
  labels: { boxWidth: 14, font: { size: 12 }, color: TEMA.legenda, ...extra },
});
const eixoX = (mini) => ({ grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: mini ? 5 : 8, maxRotation: 0, color: TEMA.tick, font: { size: 11 } } });
const tituloDeEixo = (mini, texto) => ({ display: !mini, text: texto, color: TEMA.tick, font: { size: 11 } });

// Escreve o nome do limite em cima da linha tracejada, do lado em que a curva não passa:
// à esquerda no INC-01 (o deslocamento só sobe para a direita); à direita no HID-01, que
// chega perto dos limites na cheia de janeiro e fevereiro, no começo do gráfico.
const rotulosDeLimite = {
  id: 'rotulosDeLimite',
  afterDatasetsDraw(grafico) {
    const { ctx, chartArea, scales } = grafico;
    grafico.data.datasets.forEach((d) => {
      if (!d.limite) return;
      const y = scales.y.getPixelForValue(d.limite.valor);
      const direita = d.limite.lado === 'direita';
      ctx.save();
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillStyle = d.borderColor;
      ctx.textAlign = direita ? 'right' : 'left';
      ctx.fillText(d.limite.texto, direita ? chartArea.right - 6 : chartArea.left + 6, y - 5);
      ctx.restore();
    });
  },
};

// Limite que ficou fora da faixa do eixo y não tem linha para rotular; a nota diz onde ele está.
const notaDeLimitesFora = {
  id: 'notaDeLimitesFora',
  afterDatasetsDraw(grafico) {
    const notas = grafico.options.plugins.notaDeLimitesFora && grafico.options.plugins.notaDeLimitesFora.notas;
    if (!notas || !notas.length) return;
    const { ctx, chartArea } = grafico;
    ctx.save();
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    notas.forEach((n, i) => {
      const embaixo = n.posicao === 'baixo';
      ctx.textBaseline = embaixo ? 'bottom' : 'top';
      const x = chartArea.left + 6;
      const y = embaixo ? chartArea.bottom - 4 - i * 16 : chartArea.top + 4 + i * 16;
      // Uma tarja do fundo atrás do texto: no ACL-01 a nota do alerta cai sobre as barras de
      // temperatura, que ocupam a metade de baixo, e o vermelho sobre o cinza ficava ilegível.
      const largura = ctx.measureText(n.texto).width;
      ctx.fillStyle = 'rgba(11, 19, 27, .85)';
      ctx.fillRect(x - 3, embaixo ? y - 14 : y - 1, largura + 6, 15);
      ctx.fillStyle = n.cor;
      ctx.fillText(n.texto, x, y);
    });
    ctx.restore();
  },
};

/** Devolve a instância do Chart (quem chamou deve chamar .destroy() ao trocar de ficha). */
export function criarGraficoSensor(canvas, sensor, { mini = false } = {}) {
  if (!window.Chart) throw new Error('A biblioteca Chart.js não carregou (cdnjs.cloudflare.com).');
  const leituras = sensor.leituras;
  const datas = leituras.map((l) => l.data);
  const maiorChuva = Math.max(...leituras.map((l) => l.chuva_mm));
  const limite = (valor, texto, cor) => ({
    type: 'line', label: texto, data: datas.map(() => valor), yAxisID: 'y', order: 0,
    borderColor: cor, borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, pointHitRadius: 0,
    fill: false, limite: { valor, texto },
  });
  return new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: datas.map(dataCurta),
      datasets: [
        {
          type: 'line', label: 'Deslocamento acumulado (mm)', data: leituras.map((l) => l.deslocamento_mm),
          yAxisID: 'y', order: 1, borderColor: TEMA.linha, backgroundColor: TEMA.linha,
          borderWidth: 2.5, pointRadius: mini ? 0 : 2, pointHoverRadius: 5, tension: 0.25,
        },
        {
          type: 'bar', label: 'Chuva semanal (mm)', data: leituras.map((l) => l.chuva_mm),
          yAxisID: 'y1', order: 2, backgroundColor: TEMA.barras, borderWidth: 0, barPercentage: 0.9, categoryPercentage: 1,
        },
        limite(sensor.limite_atencao_mm, `Atenção ${sensor.limite_atencao_mm} mm`, COR_SENSOR['Atenção']),
        limite(sensor.limite_alerta_mm, `Alerta ${sensor.limite_alerta_mm} mm`, corNoEscuro(COR_SENSOR.Alerta)),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: legendaEscura(mini, { filter: (item, dados) => !dados.datasets[item.datasetIndex].limite }),
        tooltip: {
          ...tooltipEscuro,
          filter: (item) => !item.dataset.limite,
          callbacks: {
            title: (itens) => dataBR(datas[itens[0].dataIndex]),
            label: (item) => (item.dataset.yAxisID === 'y1'
              ? ` Chuva: ${item.parsed.y} mm`
              : ` Deslocamento: ${fmtMm(item.parsed.y)}`),
          },
        },
      },
      scales: {
        x: eixoX(mini),
        y: {
          // Sugerido, como no criarGraficoPonte: com `max` o eixo terminava em 29 mm, uma marca fora da
          // escala de 5 em 5 (medido em 02/11/2026 com Chart.getChart(...).scales.y.ticks).
          position: 'left', min: 0, suggestedMax: Math.ceil(sensor.limite_alerta_mm * 1.12),
          title: tituloDeEixo(mini, 'Deslocamento (mm)'),
          ticks: { color: TEMA.tick, font: { size: 11 } }, grid: { color: TEMA.grade },
        },
        y1: {
          position: 'right', min: 0, suggestedMax: Math.max(40, maiorChuva * 2.4),
          title: tituloDeEixo(mini, 'Chuva (mm)'),
          ticks: { color: TEMA.tick, font: { size: 11 } }, grid: { display: false },
        },
      },
    },
    plugins: [rotulosDeLimite],
  });
}

export function descricaoDoGrafico(sensor) {
  const l = sensor.leituras;
  return `Gráfico do sensor ${sensor.id}: deslocamento acumulado de ${fmtMm(l[0].deslocamento_mm)} em ${dataCurta(l[0].data)} `
    + `a ${fmtMm(l[l.length - 1].deslocamento_mm)} em ${dataCurta(l[l.length - 1].data)}, com chuva semanal em barras e linhas de limite de atenção e alerta.`;
}

/** Gráfico do HID-01: a altura livre sob a viga em linha, a vazão em barras. */
export function criarGraficoRio(canvas, medidor, { mini = false } = {}) {
  if (!window.Chart) throw new Error('A biblioteca Chart.js não carregou (cdnjs.cloudflare.com).');
  const leituras = medidor.leituras;
  const datas = leituras.map((l) => l.data);
  const gabarito = medidor.cota_fundo_vigas_m - medidor.cota_fundo_vale_m;
  const maiorVazao = Math.max(...leituras.map((l) => l.vazao_m3s));
  const limite = (valor, texto, cor) => ({
    type: 'line', label: texto, data: datas.map(() => valor), yAxisID: 'y', order: 0,
    borderColor: cor, borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, pointHitRadius: 0,
    fill: false, limite: { valor, texto, lado: 'direita' },
  });
  const t = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: datas.map(dataCurta),
      datasets: [
        {
          type: 'line', label: 'Altura livre sob a viga (m)', data: leituras.map((l) => l.altura_livre_m),
          yAxisID: 'y', order: 1, borderColor: TEMA.linha, backgroundColor: TEMA.linha,
          borderWidth: 2.5, pointRadius: mini ? 0 : 2, pointHoverRadius: 5, tension: 0.25,
        },
        {
          type: 'bar', label: 'Vazão no pico da semana (m³/s)', data: leituras.map((l) => l.vazao_m3s),
          yAxisID: 'y1', order: 2, backgroundColor: TEMA.barras, borderWidth: 0, barPercentage: 0.9, categoryPercentage: 1,
        },
        limite(medidor.limite_atencao_m, `Atenção ${t(medidor.limite_atencao_m)} m`, COR_SENSOR['Atenção']),
        limite(medidor.limite_alerta_m, `Alerta ${t(medidor.limite_alerta_m)} m`, corNoEscuro(COR_SENSOR.Alerta)),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: legendaEscura(mini, { filter: (item, dados) => !dados.datasets[item.datasetIndex].limite }),
        tooltip: {
          ...tooltipEscuro,
          filter: (item) => !item.dataset.limite,
          callbacks: {
            title: (itens) => dataBR(datas[itens[0].dataIndex]),
            label: (item) => (item.dataset.yAxisID === 'y1'
              ? ` Vazão: ${fmtVazao(item.parsed.y)}`
              : ` Altura livre: ${fmtM(item.parsed.y)}`),
          },
        },
      },
      scales: {
        x: eixoX(mini),
        // De zero (a água na viga) até o vale seco: a linha que desce é o rio subindo.
        y: {
          position: 'left', min: 0, max: Math.ceil(gabarito),
          title: tituloDeEixo(mini, 'Altura livre (m)'),
          ticks: { color: TEMA.tick, font: { size: 11 } }, grid: { color: TEMA.grade },
        },
        y1: {
          position: 'right', min: 0, suggestedMax: maiorVazao * 2.2,
          title: tituloDeEixo(mini, 'Vazão (m³/s)'),
          ticks: { color: TEMA.tick, font: { size: 11 } }, grid: { display: false },
        },
      },
    },
    plugins: [rotulosDeLimite],
  });
}

export function descricaoDoGraficoRio(medidor) {
  const l = medidor.leituras;
  const menor = l.reduce((a, b) => (b.altura_livre_m < a.altura_livre_m ? b : a));
  return `Gráfico do medidor ${medidor.id}: altura livre sob a viga de ${fmtM(l[0].altura_livre_m)} em ${dataCurta(l[0].data)} `
    + `a ${fmtM(l[l.length - 1].altura_livre_m)} em ${dataCurta(l[l.length - 1].data)}, com a menor, ${fmtM(menor.altura_livre_m)}, em ${dataCurta(menor.data)}; `
    + 'vazão semanal em barras e linhas de limite de atenção e alerta.';
}

// ---------- sensores da estrutura da ponte ----------
// O eixo y de um sensor da ponte inclui um limite só quando ele está perto dos dados (a menos de 4×
// a amplitude deles, para fora do intervalo); do contrário a curva ficaria achatada na base do gráfico.
// Com 3× o limite de atenção do ACL-01 ficava de fora por 0,004 Hz (dados de 3,093 a 3,136, amplitude
// 0,043; a atenção, 2,96, está a 0,133 e 3× dá 0,129), e ele é justamente o que se quer ver; com 4×
// (0,172) entra, e o alerta (2,81, a 0,283) continua fora. EROS-01 (0,25 a 0,91 m, limites 1 e 2) e
// JUN-01 (16,6 a 21,9 mm, limites 10 e 5) incluem os dois. O que fica de fora vira uma nota no gráfico.
const FATOR_DE_AMPLITUDE = 4;
const FOLGA_DO_EIXO = 0.15;

function faixaDoEixo(valores, limites) {
  const lo = Math.min(...valores);
  const hi = Math.max(...valores);
  const amplitude = hi - lo;
  const distancia = (v) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  const dentro = limites.map((v) => distancia(v) < FATOR_DE_AMPLITUDE * amplitude);
  const incluidos = limites.filter((v, i) => dentro[i]);
  let min = Math.min(lo, ...incluidos);
  let max = Math.max(hi, ...incluidos);
  // Grandeza que não é negativa e cujo menor valor do quadro é pequeno diante do maior (a junta, com
  // alerta de 5 mm e leituras de 22): começar em zero mostra quanto falta para fechar.
  if (min > 0 && min < max * 0.5) {
    min = 0;
    max *= 1 + FOLGA_DO_EIXO / 2;
  } else {
    const folga = (max - min) * FOLGA_DO_EIXO || Math.abs(max) * 0.05 || 1;
    min -= folga;
    max += folga;
  }
  return { min, max, dentro, lo, hi };
}

// O nome do limite fica do lado do gráfico em que a curva passa mais longe dele: se o ponto mais
// próximo do limite está na primeira metade da série, a nota vai para a direita.
function ladoDoRotulo(valores, limite) {
  let melhor = 0;
  valores.forEach((v, i) => { if (Math.abs(v - limite) < Math.abs(valores[melhor] - limite)) melhor = i; });
  return melhor < valores.length / 2 ? 'direita' : 'esquerda';
}

export function criarGraficoPonte(canvas, sensor, { mini = false } = {}) {
  if (!window.Chart) throw new Error('A biblioteca Chart.js não carregou (cdnjs.cloudflare.com).');
  const leituras = sensor.leituras;
  const datas = leituras.map((l) => l.data);
  const valores = leituras.map((l) => l.valor);
  const est = estadoDoSensorPonte(sensor);
  const cor = est.nome === 'Normal' ? TEMA.verde : corNoEscuro(est.cor);
  const sec = sensor.secundaria || null;
  const temperaturas = sec ? leituras.map((l) => l[sec.chave]) : null;

  const limites = [
    { nome: 'Atenção', valor: sensor.limite_atencao, cor: COR_SENSOR['Atenção'] },
    { nome: 'Alerta', valor: sensor.limite_alerta, cor: corNoEscuro(COR_SENSOR.Alerta) },
  ];
  const faixa = faixaDoEixo(valores, limites.map((l) => l.valor));
  const texto = (v) => `${fmtDec(v, 0, sensor.casas)} ${sensor.unidade}`;
  const datasetsDeLimite = [];
  const notas = [];
  limites.forEach((l, i) => {
    if (faixa.dentro[i]) {
      datasetsDeLimite.push({
        type: 'line', label: `${l.nome} ${texto(l.valor)}`, data: datas.map(() => l.valor), yAxisID: 'y', order: 0,
        borderColor: l.cor, borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, pointHitRadius: 0,
        fill: false, limite: { valor: l.valor, texto: `${l.nome} ${texto(l.valor)}`, lado: ladoDoRotulo(valores, l.valor) },
      });
    } else {
      const abaixo = l.valor < faixa.lo;
      notas.push({ texto: `${l.nome} ${texto(l.valor)}, ${abaixo ? 'abaixo' : 'acima'} da escala`, cor: l.cor, posicao: abaixo ? 'baixo' : 'cima' });
    }
  });

  const datasets = [
    {
      type: 'line', label: `${sensor.nome} (${sensor.unidade})`, data: valores,
      yAxisID: 'y', order: 1, borderColor: cor, backgroundColor: cor,
      borderWidth: 2.5, pointRadius: mini ? 0 : 2, pointHoverRadius: 5, tension: 0.25,
    },
  ];
  if (temperaturas) {
    datasets.push({
      type: 'bar', label: `${sec.rotulo} (${sec.unidade})`, data: temperaturas,
      yAxisID: 'y1', order: 2, backgroundColor: TEMA.barrasTemperatura, borderWidth: 0, barPercentage: 0.9, categoryPercentage: 1,
    });
  }
  datasets.push(...datasetsDeLimite);

  const scales = {
    x: eixoX(mini),
    // Sugerida, e não imposta: com `min`/`max` o Chart.js escreve a ponta exata no eixo, e saíam
    // 2,93 e 3,16 Hz no ACL-01, 2,15 m no EROS-01 e 23,5 mm no JUN-01; sugerida, ele arredonda
    // para o passo das marcas de dentro. O `beginAtZero: false` é obrigatório: o gráfico é do tipo
  // barra (por causa da temperatura), e barra começa no zero; sem ele, o ACL-01 saiu de 0 a 3,5 Hz e
  // a curva de 3,09 a 3,14 virou uma reta no alto (medido em 02/11/2026).
    y: {
      position: 'left', beginAtZero: false, suggestedMin: faixa.min, suggestedMax: faixa.max,
      title: tituloDeEixo(mini, `${sensor.nome} (${sensor.unidade})`),
      ticks: { color: TEMA.tick, font: { size: 11 }, callback: (v) => fmtDec(v, 0, sensor.casas) },
      grid: { color: TEMA.grade },
    },
  };
  if (temperaturas) {
    // As barras de temperatura ocupam só a metade de baixo: a curva do sensor é o assunto.
    scales.y1 = {
      position: 'right', min: 0, suggestedMax: Math.max(...temperaturas) * 2.2,
      title: tituloDeEixo(mini, `${sec.rotulo} (${sec.unidade})`),
      ticks: { color: TEMA.tick, font: { size: 11 } }, grid: { display: false },
    };
  }

  return new window.Chart(canvas, {
    type: 'bar',
    data: { labels: datas.map(dataCurta), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: legendaEscura(mini, { filter: (item, dados) => !dados.datasets[item.datasetIndex].limite }),
        tooltip: {
          ...tooltipEscuro,
          filter: (item) => !item.dataset.limite,
          callbacks: {
            title: (itens) => dataBR(datas[itens[0].dataIndex]),
            label: (item) => (item.dataset.yAxisID === 'y1'
              ? ` ${sec.rotulo}: ${fmtDec(item.parsed.y, 1, 1)} ${sec.unidade}`
              : ` ${sensor.nome}: ${fmtValorSensor(sensor, item.parsed.y)}`),
          },
        },
        notaDeLimitesFora: { notas },
      },
      scales,
    },
    plugins: [rotulosDeLimite, notaDeLimitesFora],
  });
}

export function descricaoDoGraficoPonte(sensor) {
  const l = sensor.leituras;
  const primeira = l[0];
  const ultima = l[l.length - 1];
  return `Gráfico do sensor ${sensor.id}, ${sensor.nome.toLowerCase()}: de ${fmtValorSensor(sensor, primeira.valor)} em ${dataCurta(primeira.data)} `
    + `a ${fmtValorSensor(sensor, ultima.valor)} em ${dataCurta(ultima.data)}, com os limites de atenção e alerta`
    + `${sensor.secundaria ? ` e a ${sensor.secundaria.rotulo.toLowerCase()} semanal em barras` : ''}.`;
}
