// A ficha do ativo: um só componente para mapa, 3D e painel.
import {
  h, seloFicticio, seloModelo, seloReal, pilula, rotuloTipo, corDoTipo, COR_CONDICAO, COR_CONCRETO, estadoDoSensor,
  estadoDoRio, estadoDoSensorPonte, fmtArea, fmtMm, fmtM, fmtVazao, fmtDec, fmtNum, fmtReais, fmtValorSensor, dataBR,
  dataCurta, dataHoraBR, caixaErro, mesPorExtenso,
} from './util.js';
import { criarGraficoSensor, descricaoDoGrafico, criarGraficoRio, descricaoDoGraficoRio, corNoEscuro } from './graficos.js';
import { listaDoLink, seloLink } from './cadastro.js';

// Quando a inspeção traz foto ilustrativa (um caminho em dados/fotos/), ela aparece no lugar do quadro
// cinza, com um selinho dizendo que não é do ativo; se o arquivo não carregar, volta o quadro e o erro
// vai para o console com o caminho.
function fotoDaInspecao(i) {
  const quadro = () => h('div', { class: 'foto-ilustrativa', 'aria-label': 'Foto ilustrativa, não há foto real' }, 'FOTO ILUSTRATIVA');
  if (!i.foto_ilustrativa) return quadro();
  const aviso = `Foto ilustrativa, não é do ${i.id_ativo || 'ativo'}`;
  const envoltorio = h('div', { class: 'foto-inspecao' });
  const img = h('img', {
    src: i.foto_ilustrativa, alt: aviso, title: aviso, width: 84, height: 84, loading: 'lazy',
    onerror: () => {
      console.error(`Ficha: a foto ilustrativa da inspeção de ${i.data_executada} não carregou (${i.foto_ilustrativa}).`);
      envoltorio.replaceWith(quadro());
    },
  });
  envoltorio.append(img, h('span', { class: 'selo selo-ficticio foto-selo' }, 'ilustrativa'));
  return envoltorio;
}

/** Histórico de inspeções, do mais novo ao mais antigo (usado na ficha e na linha do tempo do Painel). */
export function listaDeInspecoes(inspecoes) {
  const ordenadas = [...inspecoes].sort((a, b) => (b.data_executada || '').localeCompare(a.data_executada || ''));
  return h('ol', { class: 'inspecoes' }, ordenadas.map((i) => {
    const linhas = [
      ['Não conformidade', i.nao_conformidade || 'nenhuma registrada'],
      ['Serviço', i.servico_realizado],
      ['Decisão', i.decisao],
      ['Status', i.status],
      i.custo_rs != null ? ['Custo', fmtReais(i.custo_rs)] : null,
      i.observacao ? ['Observação', i.observacao] : null,
    ].filter(Boolean);
    return h('li', { class: 'inspecao' },
      h('div', { class: 'inspecao-texto' },
        h('div', { class: 'inspecao-topo' },
          h('time', { datetime: i.data_executada }, dataBR(i.data_executada)),
          pilula(i.condicao, COR_CONDICAO[i.condicao] || '#53687A')),
        h('p', { class: 'inspecao-atividade' }, i.atividade),
        h('dl', { class: 'campos compacto' }, linhas.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))),
      fotoDaInspecao(i));
  }));
}

// O nome do nó da ponte vem como "Ponte: IfcBeam (63 peças)"; só o número interessa na ficha.
function pecasDe(info) {
  const m = info && info.nome.match(/\((\d+)\s+pe/);
  return m ? m[1] : null;
}

// 536.132 m → "5+36,132": a estaca como está nos trechos do AIM.
export function estacaBR(metros) {
  const resto = fmtDec(metros % 100, 3, 3);
  return `${Math.floor(metros / 100)}+${resto.padStart(6, '0')}`;
}

// O que cada classe do GLB da ponte é, para dizer o que a pessoa tocou no 3D.
const NOME_DA_CLASSE = {
  IfcSlab: 'lajes e pré-lajes', IfcBeam: 'vigas, pilares e travessas', IfcBuildingElementProxy: 'apoios, barreiras, consoles e alas',
  IfcPile: 'estacas', IfcCovering: 'tabuleiro', IfcFooting: 'blocos de fundação',
};

export function criarFicha({ raiz, dados, acoes, cadastro = null }) {
  let graficos = [];
  const ativos = dados.ativos.ok ? dados.ativos.dado : null;
  const fic = dados.ficticio.ok ? dados.ficticio.dado : null;

  // As inspeções que a banca grava pelo link vêm do banco (js/cadastro.js), não do gemeo_ficticio.json:
  // por isso um bloco à parte, com o selo azul, e não dentro do bloco que leva o FICTÍCIO. É o primeiro
  // bloco da ficha porque é o mais novo e é o que quem acabou de cadastrar procura: na ponte ele ficava
  // depois do projeto, das peças, dos sensores e do rio, a ~3.900 px do topo, e o dono não achou o
  // "Sou o dono" nem o Apagar (02/11/2026).
  // Discreto de propósito: quem abre o link por curiosidade não precisa vê-lo, e o dono sabe onde procurar.
  // Aparece onde o dono vai olhar: no fim do bloco do link e, na ficha que ainda não tem nenhuma inspeção
  // do link, junto do texto de como cadastrar (nas outras, dois botões iguais na mesma ficha seriam ruído).
  function botaoDoDono() {
    if (!cadastro) return null;
    return cadastro.souDono()
      ? h('button', { class: 'link-dono', type: 'button', onclick: () => cadastro.sairDoDono() }, 'Modo dono ligado · Sair')
      : h('button', { class: 'link-dono', type: 'button', onclick: () => cadastro.entrarComoDono() }, 'Sou o dono');
  }
  function blocoDoLink(id) {
    const linhas = cadastro ? cadastro.doAtivo(id) : [];
    if (!linhas.length) return null;
    return h('section', { class: 'bloco' },
      h('h3', {}, 'Cadastradas pelo link ', seloLink()),
      listaDoLink(linhas, { comSelo: false, cadastro }),
      botaoDoDono());
  }
  const comoCadastrar = (id) => h('p', { class: 'mudo nota' },
    'Para cadastrar uma inspeção, use "Nova inspeção" no mapa ou no 3D e toque no ponto do achado. ',
    cadastro && cadastro.doAtivo(id).length ? null : botaoDoDono());

  function limparGraficos() {
    graficos.forEach((g) => g.destroy());
    graficos = [];
  }

  function campo(rotulo, valor, extra = {}) {
    if (valor === null || valor === undefined || valor === '') return null;
    return [h('dt', {}, rotulo), h('dd', extra, valor)];
  }

  function blocoPatologia(p) {
    return h('section', { class: 'bloco' },
      h('h3', {}, 'Patologia registrada ', seloFicticio()),
      h('p', { class: 'destaque-texto' }, `${p.id}: ${p.titulo}`),
      h('p', {}, p.descricao),
      h('dl', { class: 'campos' },
        campo('Gravidade', pilula(p.gravidade, COR_CONDICAO[p.gravidade] || '#53687A')),
        campo('Aberta em', dataBR(p.aberta_em)),
        campo('Ordem de serviço', p.ordem_servico),
        campo('Prazo', dataBR(p.prazo))));
  }

  function blocoSensor(s) {
    const est = estadoDoSensor(s);
    const canvas = h('canvas', { role: 'img', 'aria-label': descricaoDoGrafico(s) });
    const caixa = h('div', { class: 'grafico-mini' }, canvas);
    const bloco = h('section', { class: 'bloco' },
      h('h3', {}, `Sensor ${s.id} `, seloFicticio()),
      h('p', {}, `${s.tipo}: mede o ${s.mede}.`),
      h('dl', { class: 'campos' },
        campo('Estado', pilula(est.nome, est.cor)),
        campo('Último deslocamento', `${fmtMm(est.mm)} em ${dataBR(est.data)}`),
        campo('Limites', `atenção ${s.limite_atencao_mm} mm · alerta ${s.limite_alerta_mm} mm`),
        campo('Última transmissão', dataHoraBR(s.ultima_transmissao)),
        campo('Bateria', `${s.bateria_pct}%`)),
      caixa);
    try {
      graficos.push(criarGraficoSensor(canvas, s, { mini: true }));
    } catch (erro) {
      console.error('Falha ao desenhar o mini-gráfico do sensor na ficha:', erro);
      caixa.replaceChildren(caixaErro({ titulo: 'Não consegui desenhar o gráfico do sensor.', detalhe: erro.message }));
    }
    return bloco;
  }

  function blocoRio(r) {
    const est = estadoDoRio(r);
    const canvas = h('canvas', { role: 'img', 'aria-label': descricaoDoGraficoRio(r) });
    const caixa = h('div', { class: 'grafico-mini' }, canvas);
    const p = est.periodoFora;
    const bloco = h('section', { class: 'bloco' },
      h('h3', {}, `Medidor do rio ${r.id} `, seloFicticio()),
      h('p', {}, `${r.tipo}: mede ${r.mede}.`),
      h('dl', { class: 'campos' },
        campo('Estado', pilula(est.nome, est.cor)),
        campo('Altura livre', `${fmtM(est.ultima.altura_livre_m)} em ${dataBR(est.ultima.data)}`),
        campo('Vazão', `${fmtVazao(est.ultima.vazao_m3s)} no pico da semana`),
        campo('Menor altura livre', `${fmtM(est.menor.altura_livre_m)} em ${dataBR(est.menor.data)}`),
        campo('Passou da atenção', p ? `de ${dataCurta(p.de)} a ${dataCurta(p.ate)} (${p.semanas} semanas)` : 'nenhuma vez'),
        campo('Limites', `atenção ${fmtM(r.limite_atencao_m)} · alerta ${fmtM(r.limite_alerta_m)} de altura livre`),
        campo('Última transmissão', dataHoraBR(r.ultima_transmissao)),
        campo('Bateria', `${r.bateria_pct}%`)),
      caixa);
    try {
      graficos.push(criarGraficoRio(canvas, r, { mini: true }));
    } catch (erro) {
      console.error('Falha ao desenhar o mini-gráfico do medidor do rio na ficha:', erro);
      caixa.replaceChildren(caixaErro({ titulo: 'Não consegui desenhar o gráfico do medidor do rio.', detalhe: erro.message }));
    }
    return bloco;
  }

  // Os três sensores da estrutura (EROS-01, JUN-01, ACL-01). O gráfico de cada um mora no Painel; aqui
  // só o valor de hoje, o estado e o que é o aparelho.
  function blocoSensoresDaPonte(lista) {
    return h('section', { class: 'bloco' },
      h('h3', {}, 'Sensores da estrutura ', seloFicticio()),
      h('ul', { class: 'sensores-ponte' }, lista.map((s) => {
        const est = estadoDoSensorPonte(s);
        const cor = corNoEscuro(est.cor);
        return h('li', { class: 'sensor-ponte' },
          h('div', { class: 'sensor-ponte-topo' }, h('b', {}, s.id), ` ${s.nome}`),
          h('div', { class: 'sensor-ponte-valor' },
            h('span', { class: 'sensor-ponte-numero', estilo: { color: cor } }, fmtValorSensor(s, est.valor)),
            pilula(est.nome, cor)),
          h('p', { class: 'mudo sensor-ponte-tipo' }, s.tipo));
      })));
  }

  // A série real do rio Piranga, ao lado do HID-01 inventado: é o que mostra à banca que a vazão
  // fictícia está na escala certa (pico simulado de 655 m³/s contra 664,6 na cheia de 2022).
  // Mora no rio_piranga_ana.json, e nunca no gemeo_ficticio.json, que é o que põe o selo FICTÍCIO.
  function blocoAna(medidor) {
    if (!dados.ana || !dados.ana.ok) {
      return h('section', { class: 'bloco' }, caixaErro({
        titulo: 'Não consegui carregar a série do rio Piranga (ANA).', arquivo: 'dados/rio_piranga_ana.json',
        detalhe: dados.ana && dados.ana.erro ? dados.ana.erro.message : null,
      }));
    }
    const a = dados.ana.dado;
    const f = a.fonte;
    const iso = fic ? fic.data_simulada : null;
    const mes = iso ? Number(iso.slice(5, 7)) : null;
    const pico = medidor ? estadoDoRio(medidor).menor : null;
    const maiores = a.maiores_cheias.slice(0, 3).map((c) => `${fmtVazao(c.valor)} em ${dataBR(c.data)}`).join('; ');
    return h('section', { class: 'bloco' },
      h('h3', {}, `O rio ${f.rio} de verdade `, seloReal('ANA')),
      h('p', {}, `Estação ${f.codigo_estacao} ${f.nome_estacao}, ${f.distancia_da_ponte}, com ${fmtNum(f.area_drenagem_km2)} km² de bacia. `
        + `Vazão média diária de ${dataBR(a.periodo.inicio).slice(3)} a ${dataBR(a.periodo.fim).slice(3)} (${fmtNum(a.periodo.meses)} meses).`),
      h('dl', { class: 'campos' },
        campo('Vazão média', fmtVazao(a.media)),
        campo('Na seca (Q95)', `${fmtVazao(a.q95)}, superada em 95% dos dias`),
        campo(mes ? `Média de ${mesPorExtenso(iso)}` : null, mes ? fmtVazao(a.media_por_mes[mes - 1]) : null),
        campo('Cheia anual média', `${fmtVazao(a.cheia_anual_media)} (${a.anos_completos} anos completos)`),
        campo('Cheia de 10 anos', fmtVazao(a.gumbel['10_anos'])),
        campo('Cheia de 100 anos', fmtVazao(a.gumbel['100_anos'])),
        campo('Maiores cheias', maiores),
        campo(`Cheia de ${a.cheia_de.ano}`, `${fmtVazao(a.cheia_de.valor)} em ${dataBR(a.cheia_de.data)}`)),
      pico ? h('p', { class: 'mudo nota' },
        `Para comparar: o ${medidor.id}, que é fictício, marcou ${fmtVazao(pico.vazao_m3s)} no pico da cheia simulada, em ${dataBR(pico.data)}.`) : null,
      h('p', { class: 'mudo nota' },
        `Fonte: ${f.orgao}, estação ${f.codigo_estacao}, baixada em ${dataBR(f.baixado_em)}. Onde o mês tem dado bruto e consistido, vale o consistido; `
        + `a cheia anual e o Gumbel usam só anos com os 12 meses, e ${a.descartados.length === 1 ? 'uma leitura zerada foi descartada' : `${a.descartados.length} leituras foram descartadas`} (falha de leitura).`));
  }

  // A ponte não tem ficha no AIM: o que é medido sai do ponte.json (IFC da ponte), o que é
  // inventado sai do gemeo_ficticio.json, e cada parte leva o próprio selo.
  function corpoDaPonte(sel) {
    const partes = [];
    const info = sel.no && ativos ? ativos.fora_do_aim[sel.no] : null;
    if (info) {
      partes.push(h('p', { class: 'mudo tocou' },
        `Você tocou em ${NOME_DA_CLASSE[info.classe] || info.classe} (${info.classe}, ${pecasDe(info) || '?'} peças). A ficha é da ponte inteira.`));
    }
    partes.push(blocoDoLink('OAE-01'));
    if (!dados.ponte || !dados.ponte.ok) {
      partes.push(caixaErro({
        titulo: 'Não consegui carregar os dados da ponte.', arquivo: 'dados/ponte.json',
        detalhe: dados.ponte && dados.ponte.erro ? dados.ponte.erro.message : null,
      }));
    } else {
      const p = dados.ponte.dado;
      const nVaos = p.vaos_m.length;
      const vaosIguais = p.vaos_m.every((v) => v === p.vaos_m[0]);
      partes.push(h('section', { class: 'bloco' },
        h('h3', {}, 'O projeto ', seloModelo()),
        h('dl', { class: 'campos' },
          campo('Comprimento', `${fmtM(p.comprimento_tabuleiro_m)} de tabuleiro, ${fmtM(p.comprimento_total_m)} com as lajes de transição`),
          campo('Largura', fmtM(p.largura_m)),
          campo('Vãos', vaosIguais
            ? `${nVaos} de ${fmtM(p.vaos_m[0])}, com ${p.vigas_por_vao} vigas protendidas em cada`
            : p.vaos_m.map(fmtM).join(' + ')),
          campo('Estaca', p.estaca_m ? `${estacaBR(p.estaca_m[0])} a ${estacaBR(p.estaca_m[1])}` : null),
          campo('Altura livre', `${fmtM(p.altura_livre_m)}, do fundo das vigas (cota ${fmtDec(p.cota_fundo_vigas_m, 2, 2)}) ao fundo do vale (${fmtDec(p.cota_fundo_vale_m, 2, 2)})`),
          campo('Fundação', `estacas de 1 m de diâmetro, com a ponta na cota ${fmtDec(p.cota_ponta_estacas_m, 2, 2)}`),
          campo('Modelo', `${fmtNum(p.total_pecas)} peças no IFC (${p.esquema}), ${p.autoria}`))));

      const porParte = new Map();
      p.tipos.forEach((t) => {
        if (!porParte.has(t.parte)) porParte.set(t.parte, []);
        porParte.get(t.parte).push(t);
      });
      partes.push(h('section', { class: 'bloco' },
        h('h3', {}, 'Peças por tipo ', seloModelo()),
        [...porParte.entries()].map(([parte, tipos]) => h('div', { class: 'pecas-parte' },
          h('p', { class: 'pecas-titulo' }, parte, h('span', {}, fmtNum(tipos.reduce((n, t) => n + t.pecas, 0)))),
          h('ul', { class: 'pecas' }, tipos.map((t) => h('li', {},
            h('span', { class: 'pecas-n' }, fmtNum(t.pecas)),
            h('span', {}, t.tipo && t.tipo !== t.familia ? `${t.familia} · ${t.tipo}` : t.familia))))))));

      const semDefinir = p.materiais[p.material_sem_definir] || 0;
      const materiais = Object.entries(p.materiais).filter(([m]) => m !== p.material_sem_definir);
      partes.push(h('section', { class: 'bloco' },
        h('h3', {}, 'Material ', seloModelo()),
        h('ul', { class: 'pecas' }, materiais.map(([m, n]) => h('li', {},
          h('span', { class: 'pecas-n' }, fmtNum(n)), h('span', {}, m.replace(/^DNIT - /, ''))))),
        semDefinir ? h('p', { class: 'mudo nota' },
          `${fmtNum(semDefinir)} peças (vigas, pilares, travessas, blocos e alas) chegam no IFC com o material "${p.material_sem_definir}", que é a fôrma do Revit, não o material da peça.`) : null));
    }

    if (!fic || !fic.ponte) {
      partes.push(h('section', { class: 'bloco' }, caixaErro({
        titulo: 'Não consegui carregar a operação da ponte.', arquivo: 'dados/gemeo_ficticio.json',
        detalhe: dados.ficticio.erro ? dados.ficticio.erro.message : 'o arquivo não tem a chave "ponte".',
      })));
      partes.push(blocoAna(null));
      return partes;
    }
    const op = fic.ponte;
    partes.push(h('section', { class: 'bloco' },
      h('h3', {}, `Operação (${op.id}) `, seloFicticio()),
      h('dl', { class: 'campos' },
        campo('Condição', pilula(op.condicao, COR_CONDICAO[op.condicao] || '#53687A')),
        campo('Próxima inspeção', op.proxima ? `${dataBR(op.proxima.data_planejada)}, ${op.proxima.atividade.toLowerCase()} (${op.proxima.status})` : null),
        campo('Responsável', op.proxima ? op.proxima.responsavel : null)),
      h('p', { class: 'mudo nota' }, 'Manutenção prevista (a ponte não está no COBie, então também é inventada):'),
      h('ul', { class: 'lista-simples' }, op.manutencao_prevista.map((t) => h('li', {}, t)))));
    if (fic.sensor_rio) partes.push(blocoRio(fic.sensor_rio));
    // O arquivo de dados de antes de 02/11/2026 não tinha a lista, daí a checagem.
    if (Array.isArray(fic.sensores_ponte) && fic.sensores_ponte.length) partes.push(blocoSensoresDaPonte(fic.sensores_ponte));
    partes.push(blocoAna(fic.sensor_rio || null));
    partes.push(h('section', { class: 'bloco' },
      h('h3', {}, 'Inspeções da ponte ', seloFicticio()),
      listaDeInspecoes(op.inspecoes),
      comoCadastrar('OAE-01')));
    return partes;
  }

  function corpoDeAtivo(a) {
    const partes = [blocoDoLink(a.id_ativo)];
    partes.push(h('dl', { class: 'campos' },
      campo('Nome', a.nome),
      campo('Disciplina', a.disciplina),
      campo('Uniclass', a.uniclass),
      campo('Trecho', a.trecho && a.trecho !== 'n/a' ? a.trecho : null),
      campo('Estaca inicial', a.estaca_inicial),
      campo('Estaca final', a.estaca_final),
      campo('Lado', a.lado),
      campo('Componentes', a.n_componentes != null ? String(a.n_componentes) : null),
      campo('Área', a.area_m2 != null ? fmtArea(a.area_m2) : null),
      campo('GUID IFC', a.guid_ifc, { class: 'mono' }),
      campo('Origem da geometria', a.origem_geometria)));

    const tarefas = a.tarefas_cobie ? a.tarefas_cobie.split(';').map((t) => t.trim()).filter(Boolean) : [];
    partes.push(h('section', { class: 'bloco' },
      h('h3', {}, 'Manutenção prevista (COBie) ', seloModelo()),
      tarefas.length
        ? h('ul', { class: 'lista-simples' }, tarefas.map((t) => h('li', {}, t)))
        : h('p', { class: 'mudo' }, 'Nenhuma tarefa registrada no COBie para este ativo.'),
      a.menor_intervalo_meses != null ? h('p', { class: 'mudo' }, `Menor intervalo: ${a.menor_intervalo_meses} meses.`) : null));

    if (!fic) {
      partes.push(h('section', { class: 'bloco' }, caixaErro({
        titulo: 'Não consegui carregar as inspeções, a patologia e o sensor.',
        arquivo: 'dados/gemeo_ficticio.json',
        detalhe: dados.ficticio.erro ? dados.ficticio.erro.message : null,
      })));
      return partes.filter(Boolean);
    }
    const doAtivo = fic.inspecoes.filter((i) => i.id_ativo === a.id_ativo);
    // A planejada vem antes do histórico: é o que a equipe de campo procura primeiro.
    // O gemeo_ficticio.json de antes de 02/11/2026 não tinha a lista, daí o `|| []`.
    const proxima = (fic.proximas_inspecoes || []).find((i) => i.id_ativo === a.id_ativo);
    partes.push(h('section', { class: 'bloco' },
      h('h3', {}, 'Inspeções ', doAtivo.length || proxima ? seloFicticio() : null),
      proxima ? h('div', { class: 'inspecao-proxima' },
        h('div', { class: 'inspecao-topo' },
          h('span', {}, 'Próxima: '),
          h('time', { datetime: proxima.data_planejada }, dataBR(proxima.data_planejada)),
          pilula(proxima.status, '#53687A')),
        h('p', { class: 'inspecao-atividade' },
          `${proxima.atividade}, o menor intervalo do COBie (${proxima.intervalo_meses} meses), contado de ${dataBR(fic.data_simulada)}.`),
        h('dl', { class: 'campos compacto' }, campo('Responsável', proxima.responsavel))) : null,
      doAtivo.length
        ? listaDeInspecoes(doAtivo)
        : h('p', { class: 'mudo' }, 'Nenhuma inspeção executada até agora.'),
      comoCadastrar(a.id_ativo)));
    if (fic.patologia && fic.patologia.id_ativo === a.id_ativo) partes.push(blocoPatologia(fic.patologia));
    if (fic.sensor && fic.sensor.id_ativo === a.id_ativo) partes.push(blocoSensor(fic.sensor));
    return partes.filter(Boolean);
  }

  function montar(sel) {
    if (sel.tipo === 'ativo') {
      const a = ativos && ativos.ativos[sel.id];
      if (!a) {
        return { titulo: sel.id, sub: '', selo: null, corpo: [h('p', { class: 'mudo' }, `O ativo ${sel.id} não existe em dados/ativos.json.`)], vistas: false };
      }
      return { titulo: a.id_ativo, sub: rotuloTipo(a.tipo), cor: corDoTipo(a.tipo), selo: seloModelo(), corpo: corpoDeAtivo(a), vistas: true };
    }
    const info = ativos && ativos.fora_do_aim[sel.no];
    if (sel.tipo === 'ponte') {
      const p = dados.ponte && dados.ponte.ok ? dados.ponte.dado : null;
      const sub = p && p.estaca_m ? `Estaca ${estacaBR(p.estaca_m[0])} a ${estacaBR(p.estaca_m[1])} · sem ficha no AIM` : 'Sem ficha no AIM';
      return { titulo: 'Ponte', sub, cor: COR_CONCRETO, selo: seloModelo(), corpo: corpoDaPonte(sel), vistas: true };
    }
    return {
      titulo: info ? info.nome : 'Elemento do modelo', sub: info ? info.classe : sel.no, cor: '#8DBF7F', selo: seloModelo(), vistas: false,
      corpo: [
        h('p', {}, 'Elemento do modelo federado sem ficha no AIM.'),
        h('dl', { class: 'campos' }, campo('Classe IFC', info ? info.classe : null), campo('Nome no IFC', info ? info.nome : null), campo('GUID IFC', sel.no, { class: 'mono' })),
      ],
    };
  }

  function mostrar(sel) {
    limparGraficos();
    const m = montar(sel);
    // replaceChildren escreve "null" na tela se receber null: a ficha sem botões de vista
    // (terreno, elemento sem ficha) mostrava a palavra solta no topo até 02/11/2026.
    raiz.replaceChildren(...[
      h('header', { class: 'ficha-topo' },
        m.cor ? h('span', { class: 'ficha-cor', estilo: { background: m.cor } }) : null,
        h('div', { class: 'ficha-titulo' }, h('h2', {}, m.titulo), h('p', {}, m.sub)),
        m.selo,
        h('button', { class: 'btn-fechar', type: 'button', 'aria-label': 'Fechar a ficha', onclick: () => acoes.fechar() }, '×')),
      m.vistas ? h('div', { class: 'ficha-acoes' },
        h('button', { class: 'btn', type: 'button', onclick: () => acoes.ir('mapa', sel) }, 'Ver no mapa'),
        h('button', { class: 'btn', type: 'button', onclick: () => acoes.ir('3d', sel) }, 'Ver no 3D')) : null,
      h('div', { class: 'ficha-corpo' }, m.corpo)].filter(Boolean));
    raiz.scrollTop = 0;
  }

  function limpar() {
    limparGraficos();
    raiz.replaceChildren();
  }

  return { mostrar, limpar };
}
