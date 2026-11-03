// Vista 3D (three.js). Este módulo só é importado quando a aba 3D é aberta pela primeira vez,
// para o celular não baixar o three (nem o GLB) à toa.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  corDoTipo, COR_CONCRETO, COR_TERRENO, COR_SENSOR, COR_CONDICAO, estadoDoSensor, estadoDoRio, estadoDoSensorPonte,
  fmtValorSensor, fmtMm, fmtM,
} from './util.js';
import { buscar, ErroDeDados } from './dados.js';
import { utmParaLatLon, latLonParaUtm } from './utm.js';

const COR_DESTAQUE = '#FFB300';
const LIMITE_TOQUE_PX = 6;
const NOME_TERRENO_IFC = 'IfcGeographicElement';

// ---------- foto aérea no terreno ----------
// Mesma fonte e mesmo crédito do mapa (js/mapa.js); a Esri não tem foto acima do zoom 18 neste local.
// Os ladrilhos só passam pela memória: nada é gravado em disco nem guardado em cache próprio (termos da Esri).
const URL_LADRILHO = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const ZOOM_MAXIMO_FOTO = 18;
const ZOOM_MINIMO_FOTO = 12;
const LADO_LADRILHO_PX = 256;
// Teto de textura que o celular aguenta sem derrubar a aba; a caixa do terreno do BRG4 (1075 x 706 m)
// dá 1939 x 1293 px no zoom 18, a 0,56 m por pixel, e cabe com folga.
const LADO_MAXIMO_FOTO_PX = 2048;
// 2048 px de lado cobrem no máximo 9 x 9 ladrilhos; acima de 80 é sinal de que algo saiu do esperado.
const LIMITE_LADRILHOS = 80;
const ESPERA_LADRILHO_MS = 20000;
// Folga de 2 px em volta da caixa: o retângulo UTM, visto em Mercator, fica levemente girado (convergência
// de meridianos), e os cantos do terreno não podem cair fora da imagem.
const MARGEM_FOTO_PX = 2;
// O curto é o que vai na janela do Painel no celular: lá os dois créditos por extenso ocupavam duas
// linhas de 240 px de altura (print do dono, 03/11/2026). Ele guarda o que a Esri e o OpenStreetMap
// pedem que apareça: os nomes dos fornecedores e o "© OpenStreetMap".
const CREDITO_FOTO = { longo: 'Foto: Esri, Maxar, Earthstar Geographics', curto: 'Esri, Maxar, Earthstar Geographics' };
const CREDITO_RIO = { longo: 'Rio: © colaboradores do OpenStreetMap', curto: '© OpenStreetMap' };

const aguardarUmTique = () => new Promise((ok) => setTimeout(ok, 0));

function pixelMercator(lat, lng, zoom) {
  const lado = LADO_LADRILHO_PX * 2 ** zoom;
  const x = ((lng + 180) / 360) * lado;
  const y = (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2 * lado;
  return [x, y];
}

// Escolhe o maior zoom em que a caixa cabe no teto de textura. Devolve a origem do mosaico em pixel
// Mercator inteiro, para que os ladrilhos (múltiplos de 256) encaixem sem sobrar fração.
function planejarFoto(cantos) {
  for (let zoom = ZOOM_MAXIMO_FOTO; zoom >= ZOOM_MINIMO_FOTO; zoom--) {
    const pontos = cantos.map((c) => pixelMercator(c.lat, c.lng, zoom));
    const xs = pontos.map((p) => p[0]);
    const ys = pontos.map((p) => p[1]);
    const x0 = Math.floor(Math.min(...xs)) - MARGEM_FOTO_PX;
    const y0 = Math.floor(Math.min(...ys)) - MARGEM_FOTO_PX;
    const largura = Math.ceil(Math.max(...xs)) + MARGEM_FOTO_PX - x0;
    const altura = Math.ceil(Math.max(...ys)) + MARGEM_FOTO_PX - y0;
    if (Math.max(largura, altura) > LADO_MAXIMO_FOTO_PX) continue;
    const colunaIni = Math.floor(x0 / LADO_LADRILHO_PX);
    const colunaFim = Math.floor((x0 + largura - 1) / LADO_LADRILHO_PX);
    const linhaIni = Math.floor(y0 / LADO_LADRILHO_PX);
    const linhaFim = Math.floor((y0 + altura - 1) / LADO_LADRILHO_PX);
    const total = (colunaFim - colunaIni + 1) * (linhaFim - linhaIni + 1);
    if (total > LIMITE_LADRILHOS) {
      console.warn(`Foto aérea: o zoom ${zoom} pediria ${total} ladrilhos (limite ${LIMITE_LADRILHOS}); tentando um zoom menor.`);
      continue;
    }
    return { zoom, x0, y0, largura, altura, colunaIni, colunaFim, linhaIni, linhaFim, total };
  }
  return null;
}

function baixarLadrilho(zoom, coluna, linha) {
  return new Promise((ok) => {
    const imagem = new Image();
    imagem.crossOrigin = 'anonymous'; // sem isso o canvas fica "contaminado" e o three não consegue ler a textura
    const url = URL_LADRILHO(zoom, coluna, linha);
    const relogio = setTimeout(() => {
      ok({ coluna, linha, erro: `sem resposta em ${ESPERA_LADRILHO_MS / 1000} s (${url})` });
      imagem.src = '';
    }, ESPERA_LADRILHO_MS);
    imagem.onload = () => { clearTimeout(relogio); ok({ coluna, linha, imagem }); };
    imagem.onerror = () => {
      clearTimeout(relogio);
      ok({ coluna, linha, erro: `o servidor não entregou o ladrilho: rede fora, endereço recusado ou resposta sem permissão CORS (${url})` });
    };
    imagem.src = url;
  });
}

/**
 * dados: { ativos, ficticio, ponte } já resolvidos (ficticio e ponte podem ser null).
 * ctx: { aoSelecionar(sel), aoLimpar() }
 */
export function criarCena(container, dados, ctx) {
  const reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0); // o céu é o fundo CSS do contêiner
  container.append(renderer.domElement);

  const rotulos = new CSS2DRenderer();
  rotulos.domElement.className = 'cena-rotulos';
  container.append(rotulos.domElement);

  const credito = document.createElement('p');
  credito.className = 'credito-foto-3d';
  credito.hidden = true;
  container.append(credito);

  const cena = new THREE.Scene();
  cena.add(new THREE.HemisphereLight(0xffffff, 0x8a8f94, 1.6));
  const sol = new THREE.DirectionalLight(0xffffff, 2.2);
  sol.position.set(200, 300, 150);
  cena.add(sol);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 20000);
  const controles = new OrbitControls(camera, renderer.domElement);
  controles.maxPolarAngle = Math.PI / 2 - 0.02; // não deixa a câmera passar para debaixo do terreno
  controles.screenSpacePanning = true;
  // Navegação do Revit, escolha do dono em 02/11/2026: rodinha apertada arrasta a vista e
  // Shift + rodinha gira (o OrbitControls do three 0.160 já troca PAN por giro com Shift);
  // o botão esquerdo fica só para selecionar. O direito gira, para quem usa trackpad e não
  // tem rodinha para apertar. Os dedos do celular não passam por aqui (controles.touches).
  controles.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };

  // ---------- desenho sob demanda: só renderiza quando algo mudou ----------
  let visivel = false;
  let pendente = false;
  function desenhar() {
    pendente = false;
    renderer.render(cena, camera);
    rotulos.render(cena, camera);
  }
  function pedir() {
    if (!visivel || pendente) return;
    pendente = true;
    requestAnimationFrame(desenhar);
  }
  controles.addEventListener('change', pedir);

  function ajustarTamanho() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    rotulos.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    pedir();
  }
  new ResizeObserver(ajustarTamanho).observe(container);

  // ---------- modelo ----------
  const meshes = [];
  const info = new Map();           // mesh -> { tipo, id|no }
  const meshesDoAtivo = new Map();  // id_ativo -> [mesh]
  let terreno = null;
  const meshesDaPonte = [];
  let destacadas = [];
  let caixaDoProjeto = new THREE.Box3();
  let diagonal = 800;
  const pinos = {};

  const ativos = dados.ativos.ativos;
  const guidParaAtivo = dados.ativos.guid_para_ativo;
  const foraDoAim = dados.ativos.fora_do_aim;

  function novoMaterial(cor, extras = {}) {
    return new THREE.MeshStandardMaterial({
      color: cor, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
      // O GLB veio sem normais (todas as 94 malhas têm o acessor NORMAL vazio); flatShading calcula pela derivada da tela.
      flatShading: true, ...extras,
    });
  }

  // Cada malha chega já em metros a partir de origem_utm: o 1_ifc_para_glb.py faz a subtração em dupla
  // precisão. A primeira versão errou o sinal e pôs tudo a ~700 km do zero; foi corrigida lá, não aqui.
  // Uma malha que escape disso (centro além de 5 km) é avisada, nunca reposicionada em silêncio.
  function conferirPosicao(mesh) {
    const g = mesh.geometry;
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3());
    if (Math.abs(c.x) > 5000 || Math.abs(c.z) > 5000) {
      console.error(`modelo.glb: a malha ${mesh.name} está fora do lugar (centro em ${c.x.toFixed(0)}, ${c.z.toFixed(0)} m da origem). Regere com ferramentas/1_ifc_para_glb.py.`);
    }
  }

  function prepararMalhas(raiz) {
    raiz.updateMatrixWorld(true);
    raiz.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      if (!g.attributes.normal || g.attributes.normal.count !== g.attributes.position.count) g.deleteAttribute('normal');
      conferirPosicao(o);

      const nome = o.name;
      let material;
      if (guidParaAtivo[nome]) {
        const id = guidParaAtivo[nome];
        const tipo = ativos[id].tipo;
        info.set(o, { tipo: 'ativo', id });
        if (!meshesDoAtivo.has(id)) meshesDoAtivo.set(id, []);
        meshesDoAtivo.get(id).push(o);
        material = tipo === 'Superficie TIN'
          ? novoMaterial(corDoTipo(tipo), { transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
          : novoMaterial(corDoTipo(tipo));
      } else if (nome.startsWith('PONTE_')) {
        info.set(o, { tipo: 'ponte', no: nome });
        meshesDaPonte.push(o);
        material = novoMaterial(COR_CONCRETO);
      } else {
        info.set(o, { tipo: 'fora', no: nome });
        const f = foraDoAim[nome];
        if (f && f.classe === NOME_TERRENO_IFC) terreno = o;
        // Terreno translúcido: no trecho em corte ele passaria por cima do pavimento e esconderia tudo.
        material = novoMaterial(COR_TERRENO, { transparent: true, opacity: 0.45, depthWrite: false });
      }
      o.material = material;
      meshes.push(o);
    });
    if (meshes.some((m) => !guidParaAtivo[m.name] && !m.name.startsWith('PONTE_') && !foraDoAim[m.name])) {
      console.warn('modelo.glb: há malhas cujo nome não está em ativos.json (nem ativo, nem ponte, nem fora_do_aim).');
    }
  }

  function caixaDe(lista) {
    const caixa = new THREE.Box3();
    lista.forEach((m) => { m.geometry.computeBoundingBox(); caixa.union(m.geometry.boundingBox); });
    return caixa;
  }

  // ---------- foto aérea no terreno ----------
  // O terreno nasce verde e translúcido (prepararMalhas) e só troca de roupa aqui, depois que o modelo já
  // está na tela e a foto inteira (ladrilhos + máscara) está pronta: qualquer falha antes do fim deixa o verde.
  let fotoNoTerreno = false;
  let temRio = false;
  // O traçado do rio é do OpenStreetMap (ODbL), que pede o crédito onde o dado aparece.
  function atualizarCredito() {
    const comFoto = fotoNoTerreno && terreno && terreno.visible;
    // Um span por crédito: no celular cada um vai para uma linha (estilo.css), à esquerda da dica de toque.
    const partes = [comFoto && CREDITO_FOTO, temRio && CREDITO_RIO].filter(Boolean).map(({ longo, curto }) => {
      const s = document.createElement('span');
      s.className = 'credito-item';
      const l = document.createElement('span');
      l.className = 'credito-longo';
      l.textContent = longo;
      const c = document.createElement('span');
      c.className = 'credito-curto';
      c.textContent = curto;
      s.append(l, c);
      return s;
    });
    credito.replaceChildren(...partes);
    credito.hidden = !partes.length;
  }

  // Convenção conferida em 02/11/2026 com dados/gemeo_ficticio.json: patologia.utm = [698020.719, 7707550.964]
  // e patologia.xz = [433.662, -122.455]; com origem_utm = [697587.057, 7707428.509],
  // 698020.719 - 697587.057 = +433.662 (x = leste - leste0) e
  // -(7707550.964 - 7707428.509) = -122.455 (z = -(norte - norte0)), ou seja, o norte aponta para -z.
  function pixelsDaMalha(malha, plano, leste0, norte0) {
    const pos = malha.geometry.attributes.position;
    const pixels = new Float32Array(pos.count * 2);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(malha.matrixWorld);
      const ll = utmParaLatLon(leste0 + v.x, norte0 - v.z);
      const [mx, my] = pixelMercator(ll.lat, ll.lng, plano.zoom);
      pixels[2 * i] = mx - plano.x0;
      pixels[2 * i + 1] = my - plano.y0;
    }
    return pixels;
  }

  // A máscara usa o mesmo espaço da foto: branco = terreno, preto = onde há rodovia. Todos os triângulos são
  // orientados no mesmo sentido antes de preencher: com a regra "não-zero" do canvas, dois triângulos
  // sobrepostos de sentidos opostos (a malha é DoubleSide e o sentido não é garantido) somariam zero e
  // deixariam um furo de branco dentro da estrada. O traço de 2 px (1 px de cada lado) fecha a fresta que
  // o serrilhado deixaria entre triângulos vizinhos.
  async function pintarMascara(plano, leste0, norte0) {
    const tela = document.createElement('canvas');
    tela.width = plano.largura;
    tela.height = plano.altura;
    const c = tela.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, tela.width, tela.height);
    c.fillStyle = '#000';
    c.strokeStyle = '#000';
    c.lineWidth = 2;
    c.lineJoin = 'round';
    // O canvas preenche um caminho de muitos pedaços em tempo pior que linear: medido em 02/11/2026, 20 mil
    // triângulos num caminho só levaram 3,1 s, e os mesmos 20 mil em caminhos de 100 a 500, 0,15 s. Com o
    // caminho de 20 mil, a máscara inteira levava 19 s. Então o caminho é pintado a cada 200 triângulos, e
    // a página respira a cada 20 mil, para os 200 mil e poucos da rodovia não travarem o 3D.
    const POR_CAMINHO = 200;
    const POR_FATIA = 20000;
    let noCaminho = 0;
    let naFatia = 0;
    c.beginPath();
    const fechar = () => { c.fill('nonzero'); c.stroke(); c.beginPath(); noCaminho = 0; };
    for (const malha of meshes) {
      const sel = info.get(malha);
      if (sel.tipo !== 'ativo') continue;
      // O revestimento vegetal fica fora do furo. Ele é translúcido e passa da borda dos taludes; com ele
      // na máscara, conferido em 02/11/2026, a faixa de terreno furado sob o verde deixava ver o fundo da
      // cena numa linha azul-clara ao longo de todo o corredor.
      if (ativos[sel.id].tipo === 'Superficie TIN') continue;
      const p = pixelsDaMalha(malha, plano, leste0, norte0);
      const indice = malha.geometry.index;
      const total = indice ? indice.count : malha.geometry.attributes.position.count;
      for (let k = 0; k + 2 < total; k += 3) {
        let a = indice ? indice.getX(k) : k;
        let b = indice ? indice.getX(k + 1) : k + 1;
        const d = indice ? indice.getX(k + 2) : k + 2;
        const cruz = (p[2 * b] - p[2 * a]) * (p[2 * d + 1] - p[2 * a + 1]) - (p[2 * b + 1] - p[2 * a + 1]) * (p[2 * d] - p[2 * a]);
        if (cruz < 0) { const t = a; a = b; b = t; }
        c.moveTo(p[2 * a], p[2 * a + 1]);
        c.lineTo(p[2 * b], p[2 * b + 1]);
        c.lineTo(p[2 * d], p[2 * d + 1]);
        c.closePath();
        if (++noCaminho >= POR_CAMINHO) fechar();
        if (++naFatia >= POR_FATIA) { naFatia = 0; await aguardarUmTique(); }
      }
    }
    fechar();
    encolherFuro(tela, c);
    return tela;
  }

  // O traço de 2 px e o filtro linear da textura deixavam o furo ~1 m maior que as peças, e nessa sobra,
  // sem nada atrás, aparecia o fundo da cena: uma linha azul-clara ao longo do corredor inteiro, vista
  // em 02/11/2026. Clarear com a própria máscara deslocada em até 2 px (~1,1 m no zoom 18) encolhe o furo
  // por igual, e a foto passa a entrar por baixo da borda das peças em vez de deixar vão.
  const RAIO_ENCOLHER_PX = 2;
  function encolherFuro(tela, c) {
    const copia = document.createElement('canvas');
    copia.width = tela.width;
    copia.height = tela.height;
    copia.getContext('2d').drawImage(tela, 0, 0);
    c.globalCompositeOperation = 'lighten';
    for (let dx = -RAIO_ENCOLHER_PX; dx <= RAIO_ENCOLHER_PX; dx++) {
      for (let dy = -RAIO_ENCOLHER_PX; dy <= RAIO_ENCOLHER_PX; dy++) {
        if ((dx || dy) && dx * dx + dy * dy <= RAIO_ENCOLHER_PX * RAIO_ENCOLHER_PX) c.drawImage(copia, dx, dy);
      }
    }
    c.globalCompositeOperation = 'source-over';
  }

  // Caixa XZ do terreno em coordenada do mundo, para não depender de a malha estar sem transformação.
  // Serve à foto aérea e ao corte do rio na borda do terreno.
  function caixaXZDoTerreno() {
    const pos = terreno.geometry.attributes.position;
    const v = new THREE.Vector3();
    let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(terreno.matrixWorld);
      if (v.x < xMin) xMin = v.x;
      if (v.x > xMax) xMax = v.x;
      if (v.z < zMin) zMin = v.z;
      if (v.z > zMax) zMax = v.z;
    }
    return { xMin, xMax, zMin, zMax };
  }

  async function vestirTerrenoComFoto() {
    const inicio = performance.now();
    // Deixa o modelo aparecer verde primeiro: nada daqui pode atrasar o primeiro desenho.
    await aguardarUmTique();
    try {
      if (!terreno) { console.warn('Foto aérea: o modelo não tem malha de terreno (IfcGeographicElement); a página segue sem a foto.'); return; }
      const origem = dados.ativos.origem_utm;
      if (!Array.isArray(origem) || origem.length < 2) { console.warn('Foto aérea: ativos.json sem origem_utm; a página segue sem a foto.'); return; }
      const [leste0, norte0] = origem;

      const pos = terreno.geometry.attributes.position;
      const { xMin, xMax, zMin, zMax } = caixaXZDoTerreno();
      const cantos = [[xMin, zMin], [xMax, zMin], [xMin, zMax], [xMax, zMax]].map(([x, z]) => utmParaLatLon(leste0 + x, norte0 - z));
      const plano = planejarFoto(cantos);
      if (!plano) { console.warn(`Foto aérea: a caixa do terreno não cabe em ${LADO_MAXIMO_FOTO_PX} px nem no zoom ${ZOOM_MINIMO_FOTO}; a página segue sem a foto.`); return; }

      const pedidos = [];
      for (let linha = plano.linhaIni; linha <= plano.linhaFim; linha++) {
        for (let coluna = plano.colunaIni; coluna <= plano.colunaFim; coluna++) pedidos.push(baixarLadrilho(plano.zoom, coluna, linha));
      }
      const ladrilhos = await Promise.all(pedidos);
      const falhas = ladrilhos.filter((l) => l.erro);
      if (falhas.length === ladrilhos.length) {
        console.warn(`Foto aérea: nenhum dos ${ladrilhos.length} ladrilhos chegou (zoom ${plano.zoom}); a página segue sem a foto. Primeiro erro: ${falhas[0].erro}`);
        return;
      }
      falhas.forEach((f) => console.warn(`Foto aérea: ladrilho ${plano.zoom}/${f.linha}/${f.coluna} falhou, ${f.erro}`));
      if (falhas.length) console.warn(`Foto aérea: ${falhas.length} de ${ladrilhos.length} ladrilhos falharam; esses trechos ficam em verde e a foto segue no resto.`);

      const telaFoto = document.createElement('canvas');
      telaFoto.width = plano.largura;
      telaFoto.height = plano.altura;
      const cf = telaFoto.getContext('2d');
      cf.fillStyle = COR_TERRENO;
      cf.fillRect(0, 0, telaFoto.width, telaFoto.height);
      ladrilhos.forEach((l) => {
        if (l.imagem) cf.drawImage(l.imagem, l.coluna * LADO_LADRILHO_PX - plano.x0, l.linha * LADO_LADRILHO_PX - plano.y0);
      });

      const inicioMascara = performance.now();
      const telaMascara = await pintarMascara(plano, leste0, norte0);
      const msMascara = Math.round(performance.now() - inicioMascara);

      // O GLB não traz UV no terreno (só POSITION, conferido no acessor 134 em 02/11/2026); se um dia trouxer,
      // este mapeamento por vértice o substitui, e o aviso diz que aconteceu. O mapeamento por vértice
      // absorve a diferença entre a grade UTM e a Mercator da foto. O v é invertido porque a CanvasTexture
      // tem flipY ligado: v = 0 é a borda de baixo da imagem.
      if (terreno.geometry.attributes.uv) console.warn('Foto aérea: o terreno já tinha UV no GLB; ela foi substituída pelo mapeamento por vértice.');
      const pixels = pixelsDaMalha(terreno, plano, leste0, norte0);
      const uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        uv[2 * i] = pixels[2 * i] / plano.largura;
        uv[2 * i + 1] = 1 - pixels[2 * i + 1] / plano.altura;
      }
      terreno.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

      const textura = new THREE.CanvasTexture(telaFoto);
      textura.colorSpace = THREE.SRGBColorSpace;
      textura.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
      const mascara = new THREE.CanvasTexture(telaMascara);

      // Opaco, com buraco onde há rodovia: no trecho em corte o terreno natural passa metros acima do
      // pavimento, e é o buraco (e não a translucidez de antes) que o deixa à mostra.
      const antigo = terreno.material;
      const novo = novoMaterial(0xffffff, { map: textura, alphaMap: mascara, alphaTest: 0.5 });
      novo.emissive.copy(antigo.emissive);
      novo.emissiveIntensity = antigo.emissiveIntensity;
      novo.depthTest = antigo.depthTest;
      terreno.material = novo;
      antigo.dispose();
      fotoNoTerreno = true;
      atualizarCredito();
      pedir();
      console.info(`Foto aérea no terreno: zoom ${plano.zoom}, ${plano.largura} x ${plano.altura} px, ${ladrilhos.length} ladrilhos (${falhas.length} falhas), pronta em ${Math.round(performance.now() - inicio)} ms, dos quais ${msMascara} ms na máscara.`);
    } catch (causa) {
      console.warn(`Foto aérea: falhou ao montar a foto do terreno (${causa && causa.message ? causa.message : causa}); a página segue sem a foto, com o terreno verde.`, causa);
    }
  }

  // ---------- câmera ----------
  const DIRECAO = new THREE.Vector3(-0.35, 0.6, 0.8).normalize();
  // O Painel e a aba 3D mostram o mesmo 3D (um modelo só na memória do celular), mas cada um com a
  // sua câmera: o Painel abre na vista da ponte e a aba 3D no projeto inteiro. O campo de visão do
  // Painel é o do esboço aprovado em 02/11/2026 (35°); o de 50° da aba punha o aterro da cabeceira
  // tomando metade da janela.
  const FOV_3D = 50;
  const FOV_PAINEL = 35;
  const camaras = {};
  let modoAtual = '3d';
  let animacao = 0;
  function irPara(posicao, alvo, ms = 650) {
    cancelAnimationFrame(animacao);
    // Com ms = 0 a animação dividia por zero: o relógio do quadro pode vir igual ao performance.now()
    // de agora, e 0/0 deixa a câmera em NaN. Foi o que deixou a janela do Painel cinza ao voltar da aba
    // 3D quando a troca de aba aconteceu antes de o modelo terminar de baixar (02/11/2026).
    if (reduzirMovimento || !visivel || ms <= 0) {
      camera.position.copy(posicao);
      controles.target.copy(alvo);
      controles.update();
      pedir();
      return;
    }
    const p0 = camera.position.clone();
    const t0 = controles.target.clone();
    const ini = performance.now();
    const passo = (agora) => {
      const k = Math.min(1, Math.max(0, agora - ini) / ms);
      const e = k * k * (3 - 2 * k);
      camera.position.lerpVectors(p0, posicao, e);
      controles.target.lerpVectors(t0, alvo, e);
      controles.update();
      if (k < 1) animacao = requestAnimationFrame(passo);
    };
    animacao = requestAnimationFrame(passo);
  }

  function enquadrar(centro, raio, ms, direcao = DIRECAO) {
    // Em tela vertical (celular) o campo de visão que limita é o horizontal, não o vertical.
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    // O aperto de 0,8 aproveita a tela deitada; em pé (375 px) ele cortava o trecho a oeste da ponte,
    // porque a estrada é comprida e estreita e enche justamente a largura que o celular não tem.
    const aperto = camera.aspect < 1 ? 1 : 0.8;
    const distancia = (raio / Math.sin(Math.min(vfov, hfov) / 2)) * aperto;
    irPara(centro.clone().addScaledVector(direcao, distancia), centro, ms);
  }

  function enquadrarCaixa(caixa, ms) {
    const esfera = caixa.getBoundingSphere(new THREE.Sphere());
    enquadrar(esfera.center, Math.max(esfera.radius, 12), ms);
  }

  function verTudo(ms) {
    const visiveis = meshes.filter((m) => m !== terreno && m.visible);
    enquadrarCaixa(visiveis.length ? caixaDe(visiveis) : caixaDoProjeto, ms);
  }

  // ---------- pinos ----------
  function alturaDoTerreno(x, z) {
    const raio = new THREE.Raycaster(new THREE.Vector3(x, caixaDoProjeto.max.y + 500, z), new THREE.Vector3(0, -1, 0));
    const hits = raio.intersectObjects(meshes.filter((m) => m.visible), false);
    return hits.length ? hits[0].point.y : 0;
  }

  // O rótulo é um botão dentro de uma âncora de tamanho zero: o CSS2DRenderer escreve o `transform` da
  // âncora para pô-la no ponto, e o lado do rótulo (acima, à esquerda, embaixo) fica livre para o CSS.
  // Na ponte, os quatro sensores caem a poucos metros uns dos outros e, todos acima, se encavalavam.
  const botoesDosPinos = {};
  // O fundo do rótulo diz o grupo (estilo.css, data-grupo) e a faixa da esquerda diz o estado (--cor).
  // Até 02/11/2026 todos tinham o mesmo fundo escuro, e o dono não distinguia sensor da ponte, INC-01
  // e patologia: "hoje está tudo junto". Escolhido por ele entre cor e formato: cor.
  function rotuloDoPino({ chave, cor, texto, sel, lado = 'cima', grupo }) {
    const ancora = document.createElement('div');
    ancora.className = 'ancora-3d';
    ancora.dataset.grupo = grupo;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = `rotulo-3d lado-${lado}`;
    botao.dataset.grupo = grupo;
    botao.style.setProperty('--cor', cor);
    botao.setAttribute('aria-pressed', 'false');
    botao.textContent = texto;
    botao.addEventListener('click', () => ctx.aoSelecionar(sel, { origem: 'pino', chave }));
    ancora.append(botao);
    botoesDosPinos[chave] = botao;
    return new CSS2DObject(ancora);
  }

  // `y` só vem no cadastro tocado no 3D, que sabe a altura do ponto: o raio de cima acharia o tabuleiro
  // e não o pilar que a pessoa tocou embaixo dele.
  function criarPino({ chave, xz, y: yDado = null, cor, texto, sel, lado, grupo: nomeDoGrupo }) {
    const escala = Math.max(diagonal * 0.0045, 1.5);
    const y = yDado ?? alturaDoTerreno(xz[0], xz[1]);
    const grupo = new THREE.Group();
    grupo.position.set(xz[0], y, xz[1]);
    const material = new THREE.MeshBasicMaterial({ color: cor });
    const haste = new THREE.Mesh(new THREE.CylinderGeometry(escala * 0.12, escala * 0.12, escala * 6, 8), material);
    haste.position.y = escala * 3;
    const bola = new THREE.Mesh(new THREE.SphereGeometry(escala * 1.1, 20, 14), material);
    bola.position.y = escala * 6;
    grupo.add(haste, bola);
    const rotulo = rotuloDoPino({ chave, cor, texto, sel, lado, grupo: nomeDoGrupo });
    rotulo.position.set(0, escala * 7.2, 0);
    grupo.add(rotulo);
    cena.add(grupo);
    // O voo mira a bola (6×) e não o meio da haste (3×): mirando a haste, o rótulo (7,2×) caía no alto
    // da janela e, no celular, ficava atrás do cartão da ponte e do "Voltar à ponte" (visto em 02/11/2026).
    // Mirando 5,5× ele ainda encostava no botão em 375 px (2 px de folga); com 6,5× desce mais.
    pinos[chave] = { grupo, nomeDoGrupo, sel, centro: new THREE.Vector3(xz[0], y + escala * 6.5, xz[1]), escala };
  }

  // Os sensores da ponte ficam sob o tabuleiro, no pilar e na junta: o pino de haste, que sobe do
  // primeiro ponto que o raio de cima acha, nasceria no tabuleiro com 30 m de altura (a escala dele é
  // 0,45% da diagonal do projeto, ~1,1 km) e esconderia a ponte na vista do Painel. Aqui é uma bola
  // pequena no ponto de verdade, e o voo chega por baixo, de lado.
  function criarPinoNoPonto({ chave, xz, cota, cor, texto, sel, lado, grupo: nomeDoGrupo }) {
    const y = cota - dados.ativos.origem_utm[2];
    const grupo = new THREE.Group();
    grupo.position.set(xz[0], y, xz[1]);
    const bola = new THREE.Mesh(new THREE.SphereGeometry(0.8, 18, 12), new THREE.MeshBasicMaterial({ color: cor }));
    grupo.add(bola, rotuloDoPino({ chave, cor, texto, sel, lado, grupo: nomeDoGrupo }));
    cena.add(grupo);
    // Escala 1,5 dá um raio de enquadramento de 13,5 m (focarPino usa 9×), a câmera a ~36 m. Com 4, o
    // voo parava a ~96 m, quase onde está a vista da ponte (125 m), e parecia não sair do lugar.
    pinos[chave] = { grupo, nomeDoGrupo, centro: grupo.position.clone(), escala: 1.5, direcao: direcaoDeLado() };
  }

  // Desfaz tudo que criarPino registrou: o grupo na cena, a geometria e o material (exclusivos do pino:
  // cada criarPino cria os seus), o botão do rótulo e a âncora dele no DOM. O CSS2DRenderer também tira
  // o elemento quando o objeto sai da cena, mas só se o rótulo ainda estiver na árvore; tirar aqui à mão
  // não depende disso e não faz mal se o elemento já tiver saído.
  function removerPino(chave) {
    const p = pinos[chave];
    if (!p) return;
    p.grupo.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
      if (o.isCSS2DObject && o.element.parentNode) o.element.parentNode.removeChild(o.element);
    });
    cena.remove(p.grupo);
    delete botoesDosPinos[chave];
    delete pinos[chave];
  }

  // ---------- legenda dos grupos, com caixas de ligar e desligar ----------
  // Fica dentro do contêiner do 3D, e por isso acompanha a cena entre o Painel e a aba 3D.
  const GRUPOS = [
    { chave: 'ponte', nome: 'Estrutura da ponte', curto: 'Ponte' },
    { chave: 'talude', nome: 'Talude de corte', curto: 'Talude' },
    { chave: 'atencao', nome: 'Pontos de atenção', curto: 'Atenção' },
    { chave: 'cadastro', nome: 'Cadastrado pelo link', curto: 'Link' },
  ];
  const caixasDosGrupos = {};
  let legenda = null;
  function mostrarGrupo(chave, sim) {
    Object.values(pinos).forEach((p) => {
      if (p.nomeDoGrupo !== chave) return;
      p.grupo.visible = sim;
      // O CSS2DRenderer do three 0.160 esconde o rótulo de objeto invisível, mas só no próximo desenho;
      // esconder o elemento aqui evita um toque num rótulo que já deveria ter sumido.
      p.grupo.traverse((o) => { if (o.isCSS2DObject) o.element.hidden = !sim; });
    });
    if (caixasDosGrupos[chave]) caixasDosGrupos[chave].checked = sim;
    pedir();
  }
  // Refeita a cada cadastro novo: o grupo do link nasce depois do modelo (a leitura do banco não espera o
  // GLB) e a contagem dele cresce com a demonstração. Quem foi desligado continua desligado.
  function criarLegenda() {
    const contagem = {};
    Object.values(pinos).forEach((p) => { contagem[p.nomeDoGrupo] = (contagem[p.nomeDoGrupo] || 0) + 1; });
    const presentes = GRUPOS.filter((g) => contagem[g.chave]);
    const desligados = new Set(Object.entries(caixasDosGrupos).filter(([, c]) => !c.checked).map(([k]) => k));
    if (legenda) legenda.remove();
    legenda = null;
    if (!presentes.length) return;
    legenda = document.createElement('div');
    legenda.className = 'legenda-3d';
    legenda.setAttribute('role', 'group');
    legenda.setAttribute('aria-label', 'Mostrar no 3D');
    presentes.forEach((g) => {
      const rotulo = document.createElement('label');
      rotulo.dataset.grupo = g.chave;
      const caixa = document.createElement('input');
      caixa.type = 'checkbox';
      caixa.checked = !desligados.has(g.chave);
      caixa.addEventListener('change', () => mostrarGrupo(g.chave, caixa.checked));
      caixasDosGrupos[g.chave] = caixa;
      const amostra = document.createElement('span');
      amostra.className = 'legenda-3d-amostra';
      const longo = document.createElement('span');
      longo.className = 'legenda-3d-nome';
      longo.textContent = `${g.nome} · ${contagem[g.chave]}`;
      const curto = document.createElement('span');
      curto.className = 'legenda-3d-curto';
      curto.textContent = g.curto;
      rotulo.append(caixa, amostra, longo, curto);
      legenda.append(rotulo);
    });
    container.append(legenda);
  }

  // ---------- a ponte e o rio ----------
  // O eixo sai do azimute do ponte.json (119,7°): x = leste e z = −norte, como no resto do GLB.
  function eixoDaPonte() {
    const az = THREE.MathUtils.degToRad(dados.ponte.azimute_graus);
    return new THREE.Vector3(Math.sin(az), 0, -Math.cos(az));
  }
  // Olhando de sudoeste, 40° fora da perpendicular: a vista aprovada no esboço "Sala de operação".
  const ANGULO_VISTA_PONTE = THREE.MathUtils.degToRad(-40);
  function direcaoDeLado(subida = 0.25) {
    const eixo = eixoDaPonte();
    const perp = new THREE.Vector3(-eixo.z, 0, eixo.x);
    return perp.multiplyScalar(Math.cos(ANGULO_VISTA_PONTE)).addScaledVector(eixo, Math.sin(ANGULO_VISTA_PONTE)).setY(subida).normalize();
  }

  // ---------- o rio ----------
  // A água segue a linha de centro do Piranga no OpenStreetMap (dados/rio_piranga_osm.json, do
  // ferramentas/4_rio_osm.py). Até 02/11/2026 era uma faixa reta de 70 x 1.400 m girada pelo eixo da
  // ponte, que saía do terreno nas duas pontas e cortava a foto aérea na diagonal; o dono pediu
  // "o rio precisa seguir o curso do rio". O OSM só tem a linha, não as margens: a largura é posta aqui.
  const LARGURA_RIO_M = 50;
  // A mesma declividade de 0,1% da curva-chave do HID-01 (Manning, 2_montar_dados.py): em 600 m para
  // cada lado da ponte a água sobe ou desce 0,6 m, e não fica um espelho plano atravessando morro.
  const DECLIVIDADE_RIO = 0.001;
  const PASSO_RIO_M = 5;
  const TRECHO_MINIMO_RIO_M = 100;

  // Corta a polilinha no retângulo; devolve os trechos que ficam dentro (Liang-Barsky por segmento).
  function cortarNaCaixa(pontos, caixa) {
    const trechos = [];
    let atual = [];
    for (let i = 0; i + 1 < pontos.length; i++) {
      const [a, b] = [pontos[i], pontos[i + 1]];
      const d = b.clone().sub(a);
      let t0 = 0;
      let t1 = 1;
      const bordas = [[-d.x, a.x - caixa.xMin], [d.x, caixa.xMax - a.x], [-d.z, a.z - caixa.zMin], [d.z, caixa.zMax - a.z]];
      let fora = false;
      for (const [p, q] of bordas) {
        if (p === 0) { if (q < 0) { fora = true; break; } continue; }
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
        if (t0 > t1) { fora = true; break; }
      }
      if (fora) { if (atual.length > 1) trechos.push(atual); atual = []; continue; }
      const ini = a.clone().addScaledVector(d, t0);
      const fim = a.clone().addScaledVector(d, t1);
      if (!atual.length) atual.push(ini);
      atual.push(fim);
      if (t1 < 1) { if (atual.length > 1) trechos.push(atual); atual = []; }
    }
    if (atual.length > 1) trechos.push(atual);
    return trechos;
  }

  // Uma faixa de largura constante ao longo do trecho, com a cota de cada ponto dada por `cota(s)`,
  // s = metros ao longo do rio desde o começo da linha inteira (sentido do OSM, que é o da correnteza).
  function faixaDeAgua(trecho, sInicial, cota) {
    const n = trecho.length;
    const posicoes = new Float32Array(n * 2 * 3);
    let s = sInicial;
    for (let i = 0; i < n; i++) {
      if (i > 0) s += trecho[i].distanceTo(trecho[i - 1]);
      const antes = trecho[Math.max(0, i - 1)];
      const depois = trecho[Math.min(n - 1, i + 1)];
      const dir = depois.clone().sub(antes).normalize();
      const lado = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(LARGURA_RIO_M / 2);
      const y = cota(s);
      posicoes.set([trecho[i].x + lado.x, y, trecho[i].z + lado.z, trecho[i].x - lado.x, y, trecho[i].z - lado.z], i * 6);
    }
    const indices = [];
    for (let i = 0; i + 1 < n; i++) {
      const [a, b, c, d] = [2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 3];
      indices.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(posicoes, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  // A água de hoje do HID-01 ao longo do Piranga, e as fitas dos limites de atenção e alerta.
  function criarRio() {
    const r = dados.ficticio && dados.ficticio.sensor_rio;
    const p = dados.ponte;
    if (!r || !p || !Array.isArray(p.meio_vao_central_xz)) return;
    const z0 = dados.ativos.origem_utm[2];
    const [cx, cz] = p.meio_vao_central_xz;
    const eixo = eixoDaPonte();
    const giro = Math.atan2(-eixo.z, eixo.x);
    const nivel = estadoDoRio(r).ultima.nivel_m;
    const linha = dados.rio && Array.isArray(dados.rio.pontos_xz) ? dados.rio.pontos_xz : null;
    if (!linha || linha.length < 2) {
      console.warn('3D: sem dados/rio_piranga_osm.json (ou sem pontos nele), o rio fica sem água; as fitas de atenção e alerta continuam. Para refazer: py -3 -I ferramentas/4_rio_osm.py dados');
    } else if (!terreno) {
      console.warn('3D: o modelo não tem malha de terreno, e sem ela não há onde cortar o rio; ele fica sem água.');
    } else {
      // A linha do OSM tem um ponto a cada ~80 m; a curva suave com um ponto a cada 5 m não deixa
      // quina na margem. O ponto mais perto do meio do vão é onde a água tem a cota do HID-01.
      const curva = new THREE.CatmullRomCurve3(linha.map(([x, z]) => new THREE.Vector3(x, 0, z)));
      const pontos = curva.getSpacedPoints(Math.max(2, Math.ceil(curva.getLength() / PASSO_RIO_M)));
      const meio = new THREE.Vector3(cx, 0, cz);
      const acumulado = [0];
      for (let i = 1; i < pontos.length; i++) acumulado.push(acumulado[i - 1] + pontos[i].distanceTo(pontos[i - 1]));
      let iMeio = 0;
      pontos.forEach((q, i) => { if (q.distanceTo(meio) < pontos[iMeio].distanceTo(meio)) iMeio = i; });
      const sMeio = acumulado[iMeio];
      const cota = (s) => nivel - z0 - DECLIVIDADE_RIO * (s - sMeio);
      // A caixa encolhe meia largura para a ponta da faixa não sobrar para fora do terreno.
      const t = caixaXZDoTerreno();
      const m = LARGURA_RIO_M / 2;
      const caixa = { xMin: t.xMin + m, xMax: t.xMax - m, zMin: t.zMin + m, zMax: t.zMax - m };
      const material = new THREE.MeshStandardMaterial({ color: '#2F6A9E', roughness: 0.35, metalness: 0, side: THREE.DoubleSide });
      let comprimento = 0;
      cortarNaCaixa(pontos, caixa).forEach((trecho) => {
        let metros = 0;
        for (let i = 1; i < trecho.length; i++) metros += trecho[i].distanceTo(trecho[i - 1]);
        // O rio volta a raspar o canto leste da caixa e deixava uma lasca de água solta na borda do
        // terreno, vista em 02/11/2026; trecho curto assim não é o rio, é o canto.
        if (metros < TRECHO_MINIMO_RIO_M) return;
        // s do começo do trecho: o ponto da linha mais perto dele (o corte pode cair no meio de um segmento).
        let k = 0;
        pontos.forEach((q, i) => { if (q.distanceTo(trecho[0]) < pontos[k].distanceTo(trecho[0])) k = i; });
        cena.add(new THREE.Mesh(faixaDeAgua(trecho, acumulado[k], cota), material));
        comprimento += metros;
      });
      if (!comprimento) console.warn('3D: a linha do rio não cruza a caixa do terreno; confira dados/rio_piranga_osm.json.');
      temRio = comprimento > 0;
      atualizarCredito();
      console.info(`3D: rio ${dados.rio.nome} do OpenStreetMap (way ${dados.rio.osm_way}), ${Math.round(comprimento)} m dentro do terreno, ${LARGURA_RIO_M} m de largura, a ${dados.rio.distancia_ao_meio_do_vao_m} m do meio do vão central.`);
    }
    [[r.limite_atencao_m, COR_SENSOR['Atenção']], [r.limite_alerta_m, COR_SENSOR.Alerta]].forEach(([livre, cor]) => {
      const fita = new THREE.Mesh(new THREE.BoxGeometry(p.comprimento_tabuleiro_m, 0.25, 0.25), new THREE.MeshBasicMaterial({ color: cor }));
      fita.position.set(cx, p.cota_fundo_vigas_m - livre - z0, cz);
      fita.rotation.y = giro;
      cena.add(fita);
    });
  }

  function criarPinosFicticios() {
    const fic = dados.ficticio;
    if (!fic) return;
    // Na vista da ponte do Painel, o bueiro e o talude ficam lá atrás, a 90 px um do outro na tela em 1280 px,
    // e os dois rótulos (142 e 123 px de largura) acima do pino se encavalavam: um vai para cada lado.
    const p = fic.patologia;
    criarPino({ chave: 'patologia', xz: p.xz, cor: '#C62828', texto: `Fissura · ${p.id_ativo}`, sel: { tipo: 'ativo', id: p.id_ativo }, lado: 'esq', grupo: 'atencao' });
    const s = fic.sensor;
    const est = estadoDoSensor(s);
    criarPino({ chave: 'sensor', xz: s.xz, cor: COR_SENSOR[est.nome === 'Normal' ? 'Atenção' : est.nome], texto: `${s.id} · ${fmtMm(est.mm)}`, sel: { tipo: 'ativo', id: s.id_ativo }, lado: 'dir', grupo: 'talude' });
    // O HID-01 é o radar preso sob as vigas, no meio do vão central.
    const r = fic.sensor_rio;
    if (r && dados.ponte) {
      const estRio = estadoDoRio(r);
      criarPinoNoPonto({ chave: 'rio', xz: r.xz, cota: r.cota_fundo_vigas_m, cor: estRio.cor, texto: `${r.id} · ${fmtM(estRio.ultima.altura_livre_m)} livres`, sel: { tipo: 'ponte' }, lado: 'baixo-esq', grupo: 'ponte' });
    }
    if (dados.ponte) {
      const LADOS = { 'EROS-01': 'baixo-dir', 'JUN-01': 'esq', 'ACL-01': 'esq' };
      (fic.sensores_ponte || []).forEach((sp) => {
        const e = estadoDoSensorPonte(sp);
        criarPinoNoPonto({ chave: sp.id, xz: sp.xz, cota: sp.cota_m, cor: e.cor, texto: `${sp.id} · ${fmtValorSensor(sp, e.valor)}`, sel: { tipo: 'ponte' }, lado: LADOS[sp.id], grupo: 'ponte' });
      });
    }
  }

  // ---------- o que a banca cadastra pelo link (js/cadastro.js) ----------
  // A lista do banco pode chegar antes do GLB: fica guardada e vira pino quando o modelo terminar de baixar.
  let cadastrosPendentes = [];
  // A lista passou a poder encolher (apagar) e mudar (editar): o pino de quem sumiu sai da cena e o de quem
  // mudou de condição, status ou ativo é refeito, porque a cor, o rótulo e o destino do toque nascem desses valores.
  function adicionarCadastros(linhas) {
    if (!meshes.length) { cadastrosPendentes = linhas; return; }
    const [e0, n0, z0] = dados.ativos.origem_utm;
    const assinaturaDe = (c) => `${c.condicao || ''}|${c.status || ''}|${c.id_ativo}`;
    const atuais = new Map(linhas.map((c) => [`cad-${c.id}`, c]));
    let mudou = false;
    Object.keys(pinos).filter((k) => k.startsWith('cad-')).forEach((chave) => {
      const c = atuais.get(chave);
      if (c && pinos[chave].assinatura === assinaturaDe(c)) return;
      removerPino(chave);
      mudou = true;
    });
    linhas.forEach((c) => {
      const chave = `cad-${c.id}`;
      if (pinos[chave]) return;
      const u = latLonParaUtm(c.latitude, c.longitude);
      const xz = [u.leste - e0, -(u.norte - n0)];
      // Só o toque no 3D tem a altura do ponto; o do mapa vai para o chão sob ele.
      const y = c.origem === '3d' && c.cota_m != null ? c.cota_m - z0 : null;
      const curto = c.id_ativo.length > 18 ? `${c.id_ativo.slice(0, 17)}…` : c.id_ativo;
      criarPino({
        chave, xz, y, cor: COR_CONDICAO[c.condicao] || '#5AB0F0', texto: `${c.condicao || c.status} · ${curto}`,
        sel: c.id_ativo === 'OAE-01' ? { tipo: 'ponte' } : { tipo: 'ativo', id: c.id_ativo }, lado: 'dir', grupo: 'cadastro',
      });
      pinos[chave].assinatura = assinaturaDe(c);
      mudou = true;
    });
    if (!mudou) return;
    criarLegenda();
    // Pino refeito nasce visível: se o grupo está desligado na legenda, o pino novo tem de seguir desligado.
    if (caixasDosGrupos.cadastro && !caixasDosGrupos.cadastro.checked) mostrarGrupo('cadastro', false);
    pedir();
  }

  function focarPino(chave) {
    const p = pinos[chave];
    if (!p) return;
    enquadrar(p.centro, p.escala * 9, undefined, p.direcao);
  }

  // A vista do Painel: a ponte inteira de longe, de sudoeste. A distância de 125 m é a do esboço, numa
  // janela de 620 × 410 px; na janela mais estreita ela recua, para os 105 m do tabuleiro caberem.
  function vistaDaPonte(ms) {
    const p = dados.ponte;
    if (!p || !Array.isArray(p.meio_vao_central_xz)) { focarPonte(); return; }
    camera.fov = FOV_PAINEL;
    camera.updateProjectionMatrix();
    const [cx, cz] = p.meio_vao_central_xz;
    const alvo = new THREE.Vector3(cx, p.cota_fundo_vigas_m - 3 - dados.ativos.origem_utm[2], cz);
    const distancia = 125 * Math.max(1, (620 / 410) / (camera.aspect || 1));
    const posicao = alvo.clone().addScaledVector(direcaoDeLado(0), distancia);
    posicao.y += 26 * (distancia / 125);
    irPara(posicao, alvo, ms);
  }

  function vistaInicial(ms) {
    if (modoAtual === 'painel') { vistaDaPonte(ms); return; }
    camera.fov = FOV_3D;
    camera.updateProjectionMatrix();
    verTudo(ms);
  }

  // Cada lugar guarda a sua câmera ao sair e a recupera ao voltar; a primeira vez abre na vista dele.
  function modo(novo) {
    if (novo === modoAtual) return;
    if (meshes.length) camaras[modoAtual] = { posicao: camera.position.clone(), alvo: controles.target.clone(), fov: camera.fov };
    modoAtual = novo;
    if (!meshes.length) return;
    const salva = camaras[novo];
    if (!salva) { vistaInicial(0); return; }
    cancelAnimationFrame(animacao);
    camera.fov = salva.fov;
    camera.updateProjectionMatrix();
    camera.position.copy(salva.posicao);
    controles.target.copy(salva.alvo);
    controles.update();
    pedir();
  }

  // O voo do Painel: vai até o ponto e evidencia o dispositivo (o raio-x do bueiro e do talude, que já
  // servia ao "Ver no 3D"); o rótulo escolhido fica cheio e a bola dos sensores da ponte cresce.
  function marcarPino(chave) {
    Object.entries(botoesDosPinos).forEach(([k, b]) => b.setAttribute('aria-pressed', String(k === chave)));
    Object.entries(pinos).forEach(([k, p]) => { if (p.direcao) p.grupo.scale.setScalar(k === chave ? 1.8 : 1); });
  }
  function voar(chave) {
    const fic = dados.ficticio;
    if (!pinos[chave]) { console.warn(`3D: não há pino "${chave}" para voar (o gemeo_ficticio.json tem esse sensor?).`); return; }
    // Voar até um grupo desligado na legenda o religa: senão a câmera chegaria num ponto vazio.
    if (!pinos[chave].grupo.visible) mostrarGrupo(pinos[chave].nomeDoGrupo, true);
    let sel = null;
    if (fic && chave === 'patologia') sel = { tipo: 'ativo', id: fic.patologia.id_ativo };
    if (fic && chave === 'sensor') sel = { tipo: 'ativo', id: fic.sensor.id_ativo };
    if (chave.startsWith('cad-') && pinos[chave].sel.tipo === 'ativo') sel = pinos[chave].sel;
    destacar(sel);
    marcarPino(chave);
    focarPino(chave);
  }
  function voltarParaPonte() {
    destacar(null);
    marcarPino(null);
    vistaDaPonte();
  }

  // ---------- seleção ----------
  // O destaque é desenhado por cima de tudo: o BUEIRO_001 passa sob a pista e a sub-base fica sob a base,
  // e com o teste de profundidade ligado o "Ver no 3D" do bueiro mostrava só o asfalto que o cobre.
  function limparDestaque() {
    destacadas.forEach((m) => {
      m.material.emissive.set(0x000000);
      m.material.emissiveIntensity = 1;
      m.material.depthTest = true;
      m.renderOrder = 0;
    });
    destacadas = [];
  }
  function destacar(sel) {
    limparDestaque();
    if (!sel) { pedir(); return; }
    let alvo = [];
    if (sel.tipo === 'ativo') alvo = meshesDoAtivo.get(sel.id) || [];
    // Tocar numa peça da ponte destaca só a classe tocada; abrir a ponte pelo mapa, pelo
    // pino do rio ou pelo link (sem `no`) destaca a ponte inteira.
    else if (sel.tipo === 'ponte' && !sel.no) alvo = meshesDaPonte;
    else alvo = meshes.filter((m) => info.get(m).no === sel.no);
    alvo.forEach((m) => {
      m.material.emissive.set(COR_DESTAQUE);
      m.material.emissiveIntensity = 0.7;
      m.material.depthTest = false;
      m.renderOrder = 10;
    });
    destacadas = alvo;
    pedir();
  }

  function focarAtivo(id) {
    const lista = meshesDoAtivo.get(id);
    if (!lista || !lista.length) return;
    enquadrarCaixa(caixaDe(lista));
  }

  function focarPonte() {
    if (meshesDaPonte.length) enquadrarCaixa(caixaDe(meshesDaPonte));
  }

  const raycaster = new THREE.Raycaster();
  function escolherEm(evento) {
    const r = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((evento.clientX - r.left) / r.width) * 2 - 1, -((evento.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(meshes.filter((m) => m.visible), false);
    // O terreno (translúcido, ou com buraco sobre a rodovia quando tem foto) fica por cima do pavimento em corte, e o raio
    // não enxerga o buraco: só vale se não houver mais nada na linha do toque.
    const escolhido = hits.find((x) => x.object !== terreno) || hits[0];
    if (paraOCadastro) {
      // Toque no céu não tem ponto: o cadastro continua armado esperando um toque no modelo.
      if (!escolhido) return;
      const fn = paraOCadastro;
      paraOCadastro = null;
      const [e0, n0, z0] = dados.ativos.origem_utm;
      const p = escolhido.point;
      const ll = utmParaLatLon(e0 + p.x, n0 - p.z);
      const i = info.get(escolhido.object);
      // O terreno do IFC não é ativo do AIM, e a superfície TIN cobre o trecho inteiro: nos dois, o
      // cadastro sugere o ativo mais perto (o mesmo critério do mapa).
      const ehAtivo = i.tipo === 'ativo' && ativos[i.id].tipo !== 'Superficie TIN';
      const idAtivo = ehAtivo ? i.id : i.tipo === 'ponte' ? 'OAE-01' : null;
      // O banco recusa cota fora de 400 a 800 m (cota_plausivel) e a pessoa não tem campo para
      // consertar: um ponto fora disso é erro de leitura do modelo, então vai sem cota.
      const cota = p.y + z0;
      fn({ lat: ll.lat, lng: ll.lng, cota_m: cota >= 400 && cota <= 800 ? cota : null, id_ativo: idAtivo });
      return;
    }
    if (!escolhido) { ctx.aoLimpar(); return; }
    ctx.aoSelecionar(info.get(escolhido.object), { origem: '3d' });
  }
  // "Nova inspeção" arma o próximo toque: ele vira o ponto do cadastro em vez de abrir a ficha.
  let paraOCadastro = null;

  // Diferencia toque de arrasto (e ignora o gesto de pinça): só vale se o ponteiro andou menos de 6 px.
  const ponteiros = new Set();
  let inicio = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    ponteiros.add(e.pointerId);
    // Só o botão esquerdo (e o dedo) seleciona: a rodinha e o direito movem a vista.
    inicio = ponteiros.size === 1 && e.button === 0 ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
    if (ponteiros.size !== 1) return;
    // Arrastar com a rodinha leva junto a peça que está sob o mouse, como no Revit: o alvo vai
    // para a profundidade dela, e o OrbitControls mede o arrasto por essa distância.
    if (e.pointerType === 'mouse' && e.button === 1 && !(e.shiftKey || e.ctrlKey || e.metaKey)) {
      const p = pontoNoModelo(e.clientX, e.clientY);
      if (p) { alvoNaProfundidade(p); controles.update(); }
    } else {
      recentrarNoMeio();
    }
  });
  // No Windows, apertar a rodinha liga a rolagem automática do navegador por cima do 3D.
  renderer.domElement.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });

  // ---------- navegação: o alvo do giro e do zoom é sempre um ponto do próprio modelo ----------
  // O OrbitControls gira e aproxima em torno de um alvo fixo, que aqui era o centro da caixa do projeto:
  // um ponto no ar sobre o vale. O dono achou o 3D "travado num ponto de referência"; e com o
  // zoomToCursor do three 0.160 o alvo ficava no ar à frente da câmera, que atravessava o modelo e ele
  // sumia. Aqui o alvo é achado por raio no modelo e posto na linha de visão, então a vista não pula.
  const DISTANCIA_MINIMA = 2;
  const raioNav = new THREE.Raycaster();
  function pontoNoModelo(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    raioNav.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = raioNav.intersectObjects(meshes.filter((m) => m.visible), false)[0];
    return hit ? hit.point : null;
  }
  function alvoNaProfundidade(p) {
    const frente = camera.getWorldDirection(new THREE.Vector3());
    const profundidade = Math.max(p.clone().sub(camera.position).dot(frente), DISTANCIA_MINIMA);
    controles.target.copy(camera.position).addScaledVector(frente, profundidade);
  }
  // Antes de girar: o giro passa a ser em torno da peça que está no meio da tela.
  function recentrarNoMeio() {
    if (!meshes.length) return;
    const r = renderer.domElement.getBoundingClientRect();
    const p = pontoNoModelo(r.left + r.width / 2, r.top + r.height / 2);
    if (p) { alvoNaProfundidade(p); controles.update(); }
  }

  // A roda é tratada aqui, e não pelo OrbitControls (o evento é barrado na fase de captura do contêiner):
  // aproxima rumo à peça sob o mouse e para a 2 m dela. A pinça do celular continua com o OrbitControls,
  // que aproxima rumo ao alvo — e o alvo já foi posto no modelo pelo recentrarNoMeio do primeiro toque.
  let pontoDaRoda = null;
  let tempoDaRoda = 0;
  container.addEventListener('wheel', (e) => {
    if (!meshes.length) return;
    e.preventDefault();
    e.stopPropagation();
    cancelAnimationFrame(animacao);
    const agora = performance.now();
    // O trackpad manda dezenas de eventos por segundo; o raio em 266 mil triângulos não precisa ser refeito em cada um.
    let p = agora - tempoDaRoda < 120 ? pontoDaRoda : pontoNoModelo(e.clientX, e.clientY);
    if (!p) p = controles.target.clone();
    pontoDaRoda = p;
    tempoDaRoda = agora;
    // Um clique da roda do mouse vale ~100 px no Chrome e 3 linhas no Firefox; cada clique anda 18% da distância.
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    const passo = Math.min(Math.abs(delta) / 100, 3) * 0.18;
    const ate = p.clone().sub(camera.position);
    const distancia = ate.length();
    if (delta < 0) {
      camera.position.addScaledVector(ate, Math.min(passo, Math.max(0, (distancia - DISTANCIA_MINIMA) / distancia)));
    } else {
      const centro = caixaDoProjeto.getCenter(new THREE.Vector3());
      if (camera.position.distanceTo(centro) > diagonal * 3) return;
      camera.position.addScaledVector(ate, -passo);
    }
    alvoNaProfundidade(p);
    controles.update();
    pedir();
  }, { capture: true, passive: false });
  renderer.domElement.addEventListener('pointerup', (e) => {
    ponteiros.delete(e.pointerId);
    const i = inicio;
    inicio = null;
    if (!i || i.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - i.x, e.clientY - i.y) < LIMITE_TOQUE_PX) escolherEm(e);
  });
  renderer.domElement.addEventListener('pointercancel', (e) => { ponteiros.delete(e.pointerId); inicio = null; });

  // ---------- carregamento ----------
  async function baixar(caminho, aoProgresso) {
    const resp = await buscar(caminho);
    // Com compressão HTTP o content-length não bate com os bytes lidos: nesse caso o progresso é só em MB.
    const total = resp.headers.get('content-encoding') ? 0 : Number(resp.headers.get('content-length')) || 0;
    if (!resp.body) {
      const buf = await resp.arrayBuffer();
      aoProgresso({ lidos: buf.byteLength, total: buf.byteLength });
      return buf;
    }
    const leitor = resp.body.getReader();
    const partes = [];
    let lidos = 0;
    for (;;) {
      let leitura;
      try {
        leitura = await leitor.read();
      } catch (causa) {
        throw new ErroDeDados(caminho, `o download foi interrompido (${causa.message})`, null, causa);
      }
      if (leitura.done) break;
      partes.push(leitura.value);
      lidos += leitura.value.length;
      aoProgresso({ lidos, total });
    }
    const todo = new Uint8Array(lidos);
    let pos = 0;
    partes.forEach((p) => { todo.set(p, pos); pos += p.length; });
    return todo.buffer;
  }

  async function carregar(caminho, aoProgresso) {
    const buffer = await baixar(caminho, aoProgresso);
    const gltf = await new Promise((ok, falha) => new GLTFLoader().parse(buffer, '', ok, (e) => falha(new ErroDeDados(caminho, `o GLB não pôde ser interpretado (${e.message || e})`, null, e))));
    prepararMalhas(gltf.scene);
    cena.add(gltf.scene);
    caixaDoProjeto = caixaDe(meshes.filter((m) => m !== terreno));
    diagonal = caixaDoProjeto.getSize(new THREE.Vector3()).length();
    camera.near = Math.max(diagonal / 3000, 0.2);
    camera.far = diagonal * 30;
    camera.updateProjectionMatrix();
    controles.minDistance = DISTANCIA_MINIMA;
    controles.maxDistance = diagonal * 3;
    criarRio();
    criarPinosFicticios();
    criarLegenda();
    if (cadastrosPendentes.length) adicionarCadastros(cadastrosPendentes);
    cadastrosPendentes = [];
    vistaInicial(0);
    // Sem await: a foto chega depois e pede o redesenho sozinha; os erros dela são tratados lá dentro.
    vestirTerrenoComFoto();
  }

  return {
    carregar,
    destacar,
    focarAtivo,
    focarPino,
    focarPonte,
    verTudo: () => { if (camera.fov !== FOV_3D) { camera.fov = FOV_3D; camera.updateProjectionMatrix(); } verTudo(); },
    modo,
    voar,
    voltarParaPonte,
    mostrarPonte(sim) { meshesDaPonte.forEach((m) => { m.visible = sim; }); pedir(); },
    mostrarTerreno(sim) { if (terreno) { terreno.visible = sim; atualizarCredito(); pedir(); } },
    temPino: (chave) => Boolean(pinos[chave]),
    adicionarCadastros,
    armarToque(fn) { paraOCadastro = fn; },
    desarmarToque() { paraOCadastro = null; },
    mostrar() { visivel = true; ajustarTamanho(); pedir(); },
    esconder() { visivel = false; },
  };
}
