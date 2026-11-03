// Vista Mapa (Leaflet): imagem de satélite da Esri, camadas por tipo de ativo, os marcadores
// da patologia e dos sensores e as inspeções cadastradas pelo link. Leaflet vem como global (index.html).
import {
  h, ORDEM_TIPOS, CORES_TIPO, COR_SENSOR, COR_CONCRETO, COR_RIO, corDoTipo, rotuloTipo, estadoDoSensor, estadoDoRio,
} from './util.js';
import { utmParaLatLon, distanciaM } from './utm.js';

const L = window.L;
const COR_SELECAO = '#FFD400';
const VISIVEIS_NO_INICIO = new Set(['Camada de superfície', 'Talude de corte', 'Talude de aterro', 'Superficie TIN']);
const SOBRE_O_PAVIMENTO = ['Sub-base', 'Base', 'Camada de binder'];
const ESTILO_PONTE = { color: '#FFFFFF', opacity: 0.7, weight: 1, fillColor: COR_CONCRETO, fillOpacity: 0.9 };
const CHAVE_CAMADAS = 'brg4-camadas';

// Protegido como no cadastro.js: em aba anônima de alguns navegadores o localStorage lança, e não
// lembrar a caixa aberta ou fechada não pode derrubar o mapa.
function lembrancaDasCamadas() {
  try {
    return localStorage.getItem(CHAVE_CAMADAS);
  } catch (erro) {
    console.error('Mapa: o navegador não deixou ler se a caixa Camadas estava aberta (localStorage).', erro);
    return null;
  }
}
function lembrarCamadas(aberta) {
  try {
    localStorage.setItem(CHAVE_CAMADAS, aberta ? 'aberta' : 'fechada');
  } catch (erro) {
    console.error('Mapa: o navegador não deixou guardar se a caixa Camadas está aberta (localStorage).', erro);
  }
}

function estiloDoTipo(tipo) {
  const cor = corDoTipo(tipo);
  if (tipo === 'Superficie TIN') return { color: cor, weight: 1, fillColor: cor, fillOpacity: 0.35 };
  return { color: '#FFFFFF', opacity: 0.55, weight: 1, fillColor: cor, fillOpacity: 0.78 };
}

function iconePino(classe) {
  return L.divIcon({
    className: 'pino-wrap',
    html: `<span class="pino ${classe}"></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

/**
 * dados: { ativos, ficticio, area, ponto } já resolvidos (objetos JSON, ficticio pode ser null).
 * ctx: { aoSelecionar(sel), aoAlternarLado(), aoNovaInspecao(), aviso(texto) }
 */
export function criarMapa(container, dados, ctx) {
  const mapa = L.map(container, { zoomControl: true, maxZoom: 20, minZoom: 12 });
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 18, // acima disso a Esri não tem foto neste local
    maxZoom: 20,
    attribution: 'Imagem: Esri, Maxar, Earthstar Geographics',
  }).addTo(mapa);

  const camadasDoTipo = new Map();    // tipo -> L.GeoJSON
  const camadasDoAtivo = new Map();   // id_ativo -> [camada]
  const caixasDaLegenda = new Map();  // tipo -> input checkbox
  let destacados = [];

  // "Nova inspeção" arma o próximo toque: ele vira o ponto do cadastro em vez de abrir a ficha. O ponto é
  // onde o dedo caiu, e não o centro do ativo, porque a fissura fica num lugar da ala, não no meio dela.
  let paraOCadastro = null;
  function tocou(e, sel) {
    if (!paraOCadastro) { ctx.aoSelecionar(sel); return; }
    // Sem isto o polígono passa o toque adiante e o mapa o trataria de novo como toque fora de ativo.
    L.DomEvent.stopPropagation(e);
    const fn = paraOCadastro;
    paraOCadastro = null;
    // A superfície do terreno cobre o trecho inteiro: tocar nela perto de uma boca de bueiro não quer
    // dizer "o terreno". Aí quem decide é o mais perto do cadastro.js, que só fica no terreno longe de tudo.
    const noTerreno = sel.tipo === 'ativo' && dados.ativos.ativos[sel.id] && dados.ativos.ativos[sel.id].tipo === 'Superficie TIN';
    const idAtivo = sel.tipo === 'ponte' ? 'OAE-01' : noTerreno ? null : sel.id;
    fn({ lat: e.latlng.lat, lng: e.latlng.lng, cota_m: null, id_ativo: idAtivo });
  }
  mapa.on('click', (e) => {
    if (!paraOCadastro) return;
    const fn = paraOCadastro;
    paraOCadastro = null;
    fn({ lat: e.latlng.lat, lng: e.latlng.lng, cota_m: null, id_ativo: null });
  });

  function registrar(id, camada) {
    if (!camadasDoAtivo.has(id)) camadasDoAtivo.set(id, []);
    camadasDoAtivo.get(id).push(camada);
  }

  // Uma pane por tipo, na ordem da pilha, para ligar e desligar camadas sem embaralhar quem fica por cima.
  ORDEM_TIPOS.forEach((tipo, i) => {
    const pane = mapa.createPane(`p-${i}`);
    pane.style.zIndex = String(400 + i * 2);
    const feicoes = dados.area.features.filter((f) => f.properties.tipo === tipo);
    const camada = L.geoJSON({ type: 'FeatureCollection', features: feicoes }, {
      pane: `p-${i}`,
      style: () => estiloDoTipo(tipo),
      onEachFeature: (feicao, c) => {
        const id = feicao.properties.id_ativo;
        registrar(id, c);
        c.on('click', (e) => tocou(e,{ tipo: 'ativo', id }));
      },
    });
    camadasDoTipo.set(tipo, camada);
    if (VISIVEIS_NO_INICIO.has(tipo)) camada.addTo(mapa);
  });

  const panePontos = mapa.createPane('p-pontos');
  panePontos.style.zIndex = '470';
  const pontos = L.geoJSON(dados.ponto, {
    pointToLayer: (feicao, ll) => L.circleMarker(ll, {
      pane: 'p-pontos', radius: 9, color: '#FFFFFF', weight: 2,
      fillColor: corDoTipo(feicao.properties.tipo), fillOpacity: 0.95,
    }),
    onEachFeature: (feicao, c) => {
      const id = feicao.properties.id_ativo;
      registrar(id, c);
      c.bindTooltip(id, { direction: 'top', offset: [0, -8] });
      c.on('click', (e) => tocou(e,{ tipo: 'ativo', id }));
    },
  }).addTo(mapa);

  // A ponte não está no AIM, então não vem no GeoPackage: o contorno é o retângulo do
  // tabuleiro com as lajes de transição, medido no IFC dela (ponte.json). Ela cai no buraco
  // entre os dois trechos de pavimento, então não cobre nenhum ativo.
  let ponte = null;
  if (dados.ponte) {
    mapa.createPane('p-ponte').style.zIndex = '460';
    ponte = L.polygon(dados.ponte.contorno_utm.map(([e, n]) => utmParaLatLon(e, n)), { pane: 'p-ponte', ...ESTILO_PONTE })
      .bindTooltip('Ponte', { direction: 'top' })
      .on('click', (e) => tocou(e,{ tipo: 'ponte' }))
      .addTo(mapa);
  }

  // Marcadores fictícios: patologia (vermelho), sensor do talude (âmbar) e medidor do rio (azul).
  const marcadores = {};
  const fic = dados.ficticio;
  if (fic) {
    const p = fic.patologia;
    const posP = utmParaLatLon(p.utm[0], p.utm[1]);
    marcadores.patologia = {
      latlng: posP,
      marcador: L.marker(posP, { icon: iconePino('pino-patologia'), zIndexOffset: 1000, keyboard: true, title: `${p.id}: ${p.titulo}` })
        .bindTooltip(p.id, { permanent: true, direction: 'right', offset: [14, 0], className: 'rotulo-mapa' })
        .on('click', (e) => tocou(e,{ tipo: 'ativo', id: p.id_ativo }))
        .addTo(mapa),
      ativo: p.id_ativo,
    };
    const s = fic.sensor;
    const est = estadoDoSensor(s);
    const posS = utmParaLatLon(s.utm[0], s.utm[1]);
    marcadores.sensor = {
      latlng: posS,
      marcador: L.marker(posS, { icon: iconePino(est.nome === 'Alerta' ? 'pino-alerta' : 'pino-sensor'), zIndexOffset: 900, keyboard: true, title: `${s.id}: ${est.nome}` })
        .bindTooltip(`${s.id} · ${est.nome}`, { permanent: true, direction: 'right', offset: [14, 0], className: 'rotulo-mapa' })
        .on('click', (e) => tocou(e,{ tipo: 'ativo', id: s.id_ativo }))
        .addTo(mapa),
      ativo: s.id_ativo,
    };
    const r = fic.sensor_rio;
    if (r) {
      const estRio = estadoDoRio(r);
      const posR = utmParaLatLon(r.utm[0], r.utm[1]);
      const classe = { Normal: 'pino-rio', 'Atenção': 'pino-sensor', Alerta: 'pino-alerta' }[estRio.nome];
      marcadores.rio = {
        latlng: posR,
        marcador: L.marker(posR, { icon: iconePino(classe), zIndexOffset: 800, keyboard: true, title: `${r.id}: ${estRio.nome}` })
          .bindTooltip(`${r.id} · ${estRio.nome}`, { permanent: true, direction: 'right', offset: [14, 0], className: 'rotulo-mapa' })
          .on('click', (e) => tocou(e,{ tipo: 'ponte' }))
          .addTo(mapa),
      };
    }
  }

  const limitesDosDados = () => {
    const b = L.geoJSON(dados.area).getBounds();
    b.extend(L.geoJSON(dados.ponto).getBounds());
    if (ponte) b.extend(ponte.getBounds());
    return b;
  };
  mapa.fitBounds(limitesDosDados(), { padding: [24, 24] });

  // ---------- legenda recolhível ----------
  function linhaDaLegenda(tipo) {
    const caixa = h('input', { type: 'checkbox', checked: VISIVEIS_NO_INICIO.has(tipo) });
    caixa.addEventListener('change', () => (caixa.checked ? camadasDoTipo.get(tipo).addTo(mapa) : mapa.removeLayer(camadasDoTipo.get(tipo))));
    caixasDaLegenda.set(tipo, caixa);
    return h('label', { class: 'legenda-linha' }, caixa, h('span', { class: 'amostra', estilo: { background: corDoTipo(tipo), opacity: tipo === 'Superficie TIN' ? 0.6 : 1 } }), rotuloTipo(tipo));
  }
  const simbolo = (cor, texto, anel = false) => h('div', { class: 'legenda-linha simbolo' }, h('span', { class: `amostra redonda${anel ? ' anel' : ''}`, estilo: { background: cor } }), texto);

  const Legenda = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const caixa = h('details', { class: 'legenda-mapa' },
        // O summary em flex perde a setinha do navegador, e sem ela ninguém via que o título fecha a
        // caixa: o dono pediu "poder minimizar" uma caixa que já minimizava (02/11/2026).
        h('summary', { title: 'Abrir ou minimizar a lista de camadas' }, h('span', { class: 'legenda-nome' }, 'Camadas'), h('span', { class: 'dobra-seta', 'aria-hidden': 'true' }, '›')),
        h('div', { class: 'legenda-corpo' },
          ['Camada de superfície', 'Talude de corte', 'Talude de aterro', 'Superficie TIN'].map(linhaDaLegenda),
          h('p', { class: 'legenda-titulo' }, 'Camadas de baixo do pavimento'),
          SOBRE_O_PAVIMENTO.slice().reverse().map(linhaDaLegenda),
          h('p', { class: 'legenda-dica' }, 'As camadas se sobrepõem: desligue as de cima para tocar nas de baixo.'),
          h('p', { class: 'legenda-titulo' }, 'Símbolos'),
          simbolo(CORES_TIPO['Tubo de drenagem'], 'Bueiro e bocas'),
          simbolo(CORES_TIPO['Dissipador de energia'], 'Dissipador de energia'),
          ponte ? h('div', { class: 'legenda-linha simbolo' }, h('span', { class: 'amostra', estilo: { background: COR_CONCRETO } }), 'Ponte (sem ficha no AIM)') : null,
          fic ? simbolo('#C62828', 'Patologia (fictícia)', true) : null,
          fic ? simbolo(COR_SENSOR['Atenção'], 'Sensor do talude (fictício)', true) : null,
          fic && fic.sensor_rio ? simbolo(COR_RIO, 'Medidor do rio (fictício)', true) : null,
          simbolo('#5AB0F0', 'Inspeção cadastrada pelo link', true)));
      L.DomEvent.disableClickPropagation(caixa);
      L.DomEvent.disableScrollPropagation(caixa);
      // A legenda começa fechada para não cobrir o mapa; só abre sozinha em tela grande (ela tem ~420 px de
      // altura). Depois que a pessoa abre ou fecha, vale a escolha dela neste aparelho.
      const lembrada = lembrancaDasCamadas();
      caixa.open = lembrada ? lembrada === 'aberta' : window.matchMedia('(min-width: 900px) and (min-height: 900px)').matches;
      // No clique do título, não no "toggle": o toggle também dispara com o `open` acima, e gravava
      // "aberta" no primeiro acesso de tela grande sem a pessoa ter tocado em nada. O clique vem antes
      // de a caixa mudar (Enter e espaço no título também viram clique), por isso o "!".
      caixa.querySelector('summary').addEventListener('click', () => lembrarCamadas(!caixa.open));
      return caixa;
    },
  });
  new Legenda().addTo(mapa);

  // ---------- botões: minha posição e lado a lado ----------
  let marcaPosicao = null;
  function minhaPosicao() {
    if (!('geolocation' in navigator)) {
      ctx.aviso('Este navegador não oferece localização.');
      return;
    }
    ctx.aviso('Procurando sua posição…');
    navigator.geolocation.getCurrentPosition((pos) => {
      const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (marcaPosicao) marcaPosicao.remove();
      marcaPosicao = L.layerGroup([
        L.circle(ll, { radius: pos.coords.accuracy, color: '#1C71B5', weight: 1, fillOpacity: 0.12, interactive: false }),
        L.circleMarker(ll, { radius: 8, color: '#FFFFFF', weight: 3, fillColor: '#1C71B5', fillOpacity: 1, interactive: false }),
      ]).addTo(mapa);
      const dist = distanciaM(ll, limitesDosDados().getCenter());
      if (dist > 5000) {
        ctx.aviso(`Você está a ${(dist / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} km do trecho, fora da área mostrada.`);
      } else {
        ctx.aviso('');
        mapa.flyTo(ll, Math.max(mapa.getZoom(), 18));
      }
    }, (erro) => {
      console.error('Falha ao obter a localização:', erro);
      const motivos = {
        1: 'A localização foi negada. Libere o acesso nas configurações do navegador.',
        2: 'Não consegui determinar sua posição agora.',
        3: 'A busca pela sua posição demorou demais.',
      };
      ctx.aviso(motivos[erro.code] || 'Não foi possível obter a localização.');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  const Botoes = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const caixa = h('div', { class: 'botoes-mapa' },
        h('button', { type: 'button', class: 'btn-mapa', onclick: minhaPosicao }, 'Minha posição'),
        h('button', { type: 'button', class: 'btn-mapa', 'aria-pressed': 'false', id: 'btn-nova-inspecao-mapa', onclick: () => ctx.aoNovaInspecao() }, 'Nova inspeção'),
        h('button', { type: 'button', class: 'btn-mapa so-desktop', 'aria-pressed': 'false', id: 'btn-lado', onclick: () => ctx.aoAlternarLado() }, 'Mapa + 3D lado a lado'));
      L.DomEvent.disableClickPropagation(caixa);
      return caixa;
    },
  });
  new Botoes().addTo(mapa);

  // ---------- seleção ----------
  function limparDestaque() {
    if (ponte) ponte.setStyle(ESTILO_PONTE);
    destacados.forEach((c) => {
      if (c.feature && c.feature.geometry.type === 'Point') {
        c.setStyle({ color: '#FFFFFF', weight: 2 });
        c.setRadius(9);
      } else if (c.feature) {
        c.setStyle(estiloDoTipo(c.feature.properties.tipo));
      }
    });
    destacados = [];
  }

  function destacar(sel) {
    limparDestaque();
    if (sel && sel.tipo === 'ponte' && ponte) { ponte.setStyle({ color: COR_SELECAO, opacity: 1, weight: 4 }); return; }
    if (!sel || sel.tipo !== 'ativo') return;
    (camadasDoAtivo.get(sel.id) || []).forEach((c) => {
      if (c.feature.geometry.type === 'Point') {
        c.setStyle({ color: COR_SELECAO, weight: 4 });
        c.setRadius(12);
      } else {
        c.setStyle({ color: COR_SELECAO, opacity: 1, weight: 4 });
      }
      c.bringToFront();
      destacados.push(c);
    });
  }

  function limitesDoAtivo(id) {
    const cs = camadasDoAtivo.get(id);
    if (!cs || !cs.length) return null;
    const b = L.latLngBounds([]);
    cs.forEach((c) => b.extend(c.getBounds ? c.getBounds() : c.getLatLng()));
    return b;
  }

  function focarAtivo(id) {
    const cs = camadasDoAtivo.get(id);
    if (!cs) return;
    // Se a camada do tipo estiver desligada, liga: senão o destaque ficaria invisível.
    const tipo = cs[0].feature.properties.tipo;
    const caixa = caixasDaLegenda.get(tipo);
    if (caixa && !caixa.checked) { caixa.checked = true; camadasDoTipo.get(tipo).addTo(mapa); }
    const b = limitesDoAtivo(id);
    if (b.getNorthEast().equals(b.getSouthWest())) mapa.setView(b.getCenter(), 19);
    else mapa.fitBounds(b, { padding: [60, 60], maxZoom: 19 });
  }

  function focarPonte() {
    if (ponte) mapa.fitBounds(ponte.getBounds(), { padding: [60, 60], maxZoom: 19 });
  }

  function focarMarcador(nome) {
    const m = marcadores[nome];
    if (m) mapa.setView(m.latlng, 19);
  }

  function mostrar() {
    mapa.invalidateSize();
  }

  function marcarLado(ativo) {
    const b = container.querySelector('#btn-lado');
    if (b) b.setAttribute('aria-pressed', String(ativo));
  }

  // ---------- o que a banca cadastra pelo link (js/cadastro.js) ----------
  // Rótulo só ao passar o mouse: com permanente, dez cadastros no mesmo bueiro cobririam o mapa.
  // A lista passou a poder encolher (apagar) e mudar (editar): quem sumiu sai do mapa e quem mudou de
  // condição, status ou ativo é refeito, porque o rótulo e o clique nascem desses três valores.
  function adicionarCadastros(linhas) {
    const assinaturaDe = (c) => `${c.condicao || ''}|${c.status || ''}|${c.id_ativo}`;
    const atuais = new Map(linhas.map((c) => [`cad-${c.id}`, c]));
    Object.keys(marcadores).filter((k) => k.startsWith('cad-')).forEach((chave) => {
      const c = atuais.get(chave);
      if (c && marcadores[chave].assinatura === assinaturaDe(c)) return;
      marcadores[chave].marcador.remove();
      delete marcadores[chave];
    });
    linhas.forEach((c) => {
      const chave = `cad-${c.id}`;
      if (marcadores[chave]) return;
      const latlng = { lat: c.latitude, lng: c.longitude };
      const sel = c.id_ativo === 'OAE-01' ? { tipo: 'ponte' } : { tipo: 'ativo', id: c.id_ativo };
      marcadores[chave] = {
        latlng,
        assinatura: assinaturaDe(c),
        marcador: L.marker(latlng, { icon: iconePino('pino-cadastro'), zIndexOffset: 700, keyboard: true, title: `Inspeção cadastrada pelo link: ${c.id_ativo}` })
          .bindTooltip(`${c.condicao || c.status} · ${c.id_ativo}`, { direction: 'right', offset: [14, 0], className: 'rotulo-mapa' })
          .on('click', (e) => tocou(e, sel))
          .addTo(mapa),
      };
    });
  }

  function armarToque(fn) {
    paraOCadastro = fn;
    const b = container.querySelector('#btn-nova-inspecao-mapa');
    if (b) b.setAttribute('aria-pressed', 'true');
  }
  function desarmarToque() {
    paraOCadastro = null;
    const b = container.querySelector('#btn-nova-inspecao-mapa');
    if (b) b.setAttribute('aria-pressed', 'false');
  }

  new ResizeObserver(() => mapa.invalidateSize()).observe(container);

  return {
    mapa, mostrar, destacar, focarAtivo, focarPonte, focarMarcador, marcarLado, adicionarCadastros, armarToque, desarmarToque,
    posicaoDoMarcador: (n) => (marcadores[n] ? marcadores[n].latlng : null),
  };
}
