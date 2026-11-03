// Cadastro de inspeção pelo link: quem abre a página toca num ponto do mapa ou do 3D, preenche o
// formulário e grava no Supabase, sem login. O banco confere as mesmas regras do formulário do QField
// (supabase/1_cadastro_de_inspecao.sql); aqui elas existem para a pessoa ver o erro no campo certo
// antes de o banco recusar.
import {
  h, pilula, COR_CONDICAO, ORDEM_TIPOS, fmtReais, fmtDec, dataBR, dataHoraBR, rotuloTipo, caixaErro,
} from './util.js';
import { utmParaLatLon } from './utm.js';

// Esta chave é pública por natureza (decisão registrada no projeto): o que protege o banco são as
// regras dele, não o segredo da chave. Ela NÃO é um JWT, então vai só no cabeçalho `apikey`;
// mandar `Authorization: Bearer` com ela faz o Supabase recusar com 401.
export const SUPABASE = {
  url: 'https://lkflwnuhexpkpehvwuui.supabase.co',
  chave: 'sb_publishable_kjFiHAVQBglUY3aBLjnrQw_2eXq3x9N',
};

const BALDE = 'fotos-inspecao';
const ID_PONTE = 'OAE-01';
const TIPO_TERRENO = 'Superficie TIN';
const FOLGA_DO_TERRENO_M = 25;
const DATA_MIN = '2020-01-01';
const DATA_MAX = '2040-12-31';
const LIMITE_FOTO_BYTES = 1000000;
const PADRAO_CAMINHO_FOTO = /^inspecoes\/[A-Za-z0-9_.-]+\.jpg$/;

// Depois do 2_apagar_e_editar.sql o select é por coluna: "select=*" volta 401 porque pediria o
// segredo_hash, que o link não pode ler. Por isso a lista vive aqui, uma vez só.
const COLUNAS = 'id,id_ativo,atividade,status,data_planejada,data_executada,responsavel,condicao,nao_conformidade,'
  + 'servico_realizado,materiais_equipamentos,decisao,proxima_data,custo_rs,observacao,foto_1,foto_2,'
  + 'latitude,longitude,cota_m,origem,criado_em,editado_em';
const CHAVE_SEGREDOS = 'brg4-segredos';
const CHAVE_DONO = 'brg4-dono';

const MSG_SEM_BANCO = 'Não consegui falar com o banco (Supabase). Confira a internet. '
  + 'Se a página ficou 7 dias sem uso, o projeto gratuito adormece: o dono reativa no painel do Supabase.';
const MSG_FORMATO_FOTO = 'Este formato de foto não abriu neste navegador. Tente uma foto JPEG ou tire pela câmera.';

export const seloLink = () => h('span', { class: 'selo selo-link', title: 'Gravado por quem abriu o link, no banco do Supabase' }, 'cadastrado pelo link');

export function urlDaFoto(caminho) {
  return `${SUPABASE.url}/storage/v1/object/public/${BALDE}/${caminho}`;
}

/* ------------------------------------------------------------------ lista (leitura) */

function fotoDoLink(caminho, rotulo) {
  if (!PADRAO_CAMINHO_FOTO.test(caminho)) {
    console.error(`Cadastro: o caminho de foto "${caminho}" não tem o formato inspecoes/<nome>.jpg e não foi mostrado.`);
    return h('div', { class: 'foto-ilustrativa' }, 'foto indisponível');
  }
  const href = urlDaFoto(caminho);
  const link = h('a', { class: 'foto-inspecao', href, target: '_blank', rel: 'noopener', 'aria-label': `${rotulo}, abre em outra aba` });
  link.append(h('img', {
    src: href, alt: rotulo, width: 84, height: 84, loading: 'lazy',
    onerror: () => {
      console.error(`Cadastro: a foto ${caminho} não carregou (${href}).`);
      link.replaceWith(h('div', { class: 'foto-ilustrativa' }, 'foto indisponível'));
    },
  }));
  return link;
}

const dataDaLinha = (l) => l.data_executada || l.data_planejada || '';

// O banco devolve criado_em em UTC (+00:00): cortar o texto, como o dataHoraBR faz com as datas do
// fictício, mostrou "03/11/2026 02:38" para uma gravação das 22:38 de 02/11 em Brasília.
function quandoLocal(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return dataHoraBR(iso);
  const p = (v) => String(v).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Lista das inspeções gravadas pelo link, com a mesma cara da lista das inspeções fictícias.
 * Na ficha o selo já está no título do bloco (comSelo: false); no Painel a linha aparece sozinha e leva o selo.
 */
export function listaDoLink(linhas, { comSelo = true, cadastro = null } = {}) {
  const ordenadas = [...linhas].sort((a, b) => dataDaLinha(b).localeCompare(dataDaLinha(a))
    || (b.criado_em || '').localeCompare(a.criado_em || ''));
  return h('ol', { class: 'inspecoes' }, ordenadas.map((l) => {
    const data = dataDaLinha(l);
    const onde = [
      `tocado no ${l.origem === '3d' ? '3D' : 'mapa'}`,
      `${fmtDec(l.latitude, 6, 6)}, ${fmtDec(l.longitude, 6, 6)}`,
      l.cota_m != null ? `cota ${fmtDec(l.cota_m, 2, 2)} m` : null,
    ].filter(Boolean).join(' · ');
    const linhasDl = [
      ['Status', l.status],
      ['Não conformidade', l.nao_conformidade],
      ['Serviço', l.servico_realizado],
      ['Materiais', l.materiais_equipamentos],
      ['Decisão', l.decisao],
      ['Próxima data', l.proxima_data ? dataBR(l.proxima_data) : null],
      ['Custo', l.custo_rs != null ? fmtReais(Number(l.custo_rs)) : null],
      ['Responsável', l.responsavel],
      ['Observação', l.observacao],
      ['Onde', onde],
      ['Cadastrado em', quandoLocal(l.criado_em)],
      ['Alterado em', l.editado_em ? quandoLocal(l.editado_em) : null],
    ].filter(([, v]) => v);
    const mexe = Boolean(cadastro && cadastro.podeMexer(l));
    const fotos = [l.foto_1, l.foto_2].filter(Boolean).map((c, n) => fotoDoLink(c, `Foto ${n + 1} da inspeção de ${l.id_ativo}`));
    return h('li', { class: 'inspecao' },
      h('div', { class: 'inspecao-texto' },
        h('div', { class: 'inspecao-topo' },
          data ? h('time', { datetime: data }, dataBR(data)) : null,
          l.condicao ? pilula(l.condicao, COR_CONDICAO[l.condicao] || '#53687A') : pilula(l.status, '#53687A'),
          comSelo ? seloLink() : null),
        l.atividade ? h('p', { class: 'inspecao-atividade' }, l.atividade) : null,
        h('dl', { class: 'campos compacto' }, linhasDl.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
        mexe ? h('div', { class: 'inspecao-acoes' },
          h('button', { class: 'btn', type: 'button', onclick: () => cadastro.editar(l) }, 'Editar'),
          h('button', { class: 'btn btn-perigo', type: 'button', onclick: () => cadastro.apagar(l) }, 'Apagar')) : null),
      fotos.length ? h('div', { class: 'inspecao-fotos' }, fotos) : null);
  }));
}

/* ------------------------------------------------------------------ conversa com o Supabase */

class ErroCadastro extends Error {
  constructor(mensagem, causa = null) {
    super(mensagem);
    this.name = 'ErroCadastro';
    this.causa = causa;
  }
}

const REGRAS_DO_BANCO = {
  executada_precisa_de_condicao: 'Inspeção executada precisa da condição (aba Achado).',
  executada_precisa_de_decisao: 'Inspeção executada precisa da decisão (aba Achado).',
  reprogramar_precisa_de_data: 'Reprogramar é marcar a próxima data (aba Achado).',
  perto_do_brg4: 'O ponto ficou fora da área do BRG4.',
  status_da_lista: 'O status escolhido não é um dos permitidos.',
  condicao_da_lista: 'A condição escolhida não é uma das permitidas.',
  decisao_da_lista: 'A decisão escolhida não é uma das permitidas.',
  origem_da_lista: 'A origem do ponto não é válida (mapa ou 3D).',
  cota_plausivel: 'A cota do ponto está fora do esperado (entre 400 e 800 m).',
  custo_plausivel: 'O custo precisa estar entre R$ 0 e R$ 10.000.000.',
  datas_plausiveis: 'Alguma data está fora do intervalo de 2020 a 2040.',
  textos_curtos: 'Algum texto passou do tamanho permitido.',
  foto_no_balde: 'O caminho da foto não foi aceito pelo banco.',
};

/** Traduz a resposta de erro do PostgREST (linha) ou do Storage (foto) para uma frase que a pessoa entenda. */
function causaDoBanco(status, corpo, assunto) {
  const msg = String((corpo && corpo.message) || '');
  const codigo = corpo && corpo.code ? String(corpo.code) : '';
  // O Storage às vezes responde HTTP 400 com o código verdadeiro dentro do corpo (statusCode).
  const efetivo = Number(corpo && corpo.statusCode) || status;
  if (status >= 500) return MSG_SEM_BANCO;
  if (msg.startsWith('O cadastro pelo link chegou a 300')) return msg;
  if (codigo === '23514') {
    const regra = Object.keys(REGRAS_DO_BANCO).find((r) => msg.includes(r));
    return regra ? REGRAS_DO_BANCO[regra] : 'O banco recusou algum valor do formulário.';
  }
  if (codigo === '23503') return 'Esse ativo não existe no banco.';
  if (codigo === '42501' || efetivo === 401 || efetivo === 403) {
    return assunto === 'foto' ? 'O banco recusou o envio da foto (permissão).' : 'O banco recusou a gravação (permissão).';
  }
  if (assunto === 'foto') {
    if (efetivo === 413) return 'A foto passou de 1 MB mesmo reduzida e o banco recusou.';
    if (efetivo === 415) return 'O banco só aceita foto em JPEG.';
    return `O banco recusou a foto (HTTP ${status}).`;
  }
  return `O banco recusou a gravação (código ${codigo || status}).`;
}

/** Faz o pedido e devolve resposta + texto, seja qual for o status HTTP; só lança em falha de rede. */
async function chamar(oque, url, init, enviado) {
  try {
    const resp = await fetch(url, init);
    return { resp, texto: await resp.text() };
  } catch (erro) {
    console.error(`Cadastro: falha de rede ao ${oque}.`, { url, enviado, erro });
    throw new ErroCadastro(MSG_SEM_BANCO, erro);
  }
}

// A recusa por regra (23514) traz no "details" a linha inteira, e na edição e na gravação essa linha tem
// o segredo_hash: 64 letras hexadecimais. O segredo do aparelho tem o mesmo formato. Todo texto que vem
// do banco passa por aqui antes de ir para o console.
const ocultarSegredos = (texto) => String(texto).replace(/[0-9a-f]{64}/gi, '<oculto>');

function exigirOk(oque, { resp, texto: bruto }, enviado, assunto = 'linha') {
  if (resp.ok) return;
  const texto = ocultarSegredos(bruto);
  let corpo = null;
  try {
    corpo = JSON.parse(texto);
  } catch (erro) {
    console.error(`Cadastro: a resposta de erro ao ${oque} não era JSON.`, { status: resp.status, texto, erro });
  }
  console.error(`Cadastro: o banco recusou ao ${oque}.`, { status: resp.status, corpo: corpo || texto, enviado });
  throw new ErroCadastro(causaDoBanco(resp.status, corpo, assunto));
}

const cabecalho = (extra = {}) => ({ apikey: SUPABASE.chave, ...extra });

async function lerLinhas() {
  const oque = 'ler as inspeções cadastradas';
  const r = await chamar(oque, `${SUPABASE.url}/rest/v1/inspecoes_link?select=${COLUNAS}&order=criado_em.desc&limit=300`,
    { headers: cabecalho() }, null);
  exigirOk(oque, r, null);
  let linhas;
  try {
    linhas = JSON.parse(r.texto);
  } catch (erro) {
    console.error(`Cadastro: a resposta ao ${oque} não era JSON.`, { texto: r.texto.slice(0, 300), erro });
    throw new ErroCadastro('O banco respondeu algo que a página não entendeu.', erro);
  }
  if (!Array.isArray(linhas)) {
    console.error(`Cadastro: a resposta ao ${oque} não era uma lista.`, { resposta: linhas });
    throw new ErroCadastro('O banco respondeu algo que a página não entendeu.');
  }
  return linhas;
}

// O hash do segredo vai no corpo do insert mas nunca para o console: quem lê o log (ou um print dele)
// não pode ficar com o que identifica o autor da inspeção.
const ocultarHash = (corpo) => ('segredo_hash' in corpo ? { ...corpo, segredo_hash: '<oculto>' } : corpo);
const semHash = ({ segredo_hash: _, ...resto }) => resto;

async function gravarLinha(corpo) {
  const oque = 'gravar a inspeção';
  const visivel = ocultarHash(corpo);
  const r = await chamar(oque, `${SUPABASE.url}/rest/v1/inspecoes_link?select=${COLUNAS}`, {
    method: 'POST',
    headers: cabecalho({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(corpo),
  }, visivel);
  exigirOk(oque, r, visivel);
  let devolvido = null;
  try {
    devolvido = JSON.parse(r.texto);
  } catch (erro) {
    console.error(`Cadastro: a resposta ao ${oque} não era JSON.`, { texto: ocultarSegredos(r.texto.slice(0, 300)), erro });
  }
  const linha = Array.isArray(devolvido) ? devolvido[0] : null;
  if (!linha) {
    // A linha entrou (HTTP 2xx), só não voltou com id e data: melhor mostrar o que a pessoa preencheu
    // do que dizer que falhou e ela gravar de novo.
    console.error(`Cadastro: o banco aceitou ${oque} mas não devolveu a linha.`, { texto: ocultarSegredos(r.texto.slice(0, 300)) });
    return { ...semHash(corpo), id: null, criado_em: new Date().toISOString() };
  }
  return linha;
}

/**
 * Chama uma função do banco (rpc). A recusa por regra volta como HTTP 400, igual ao insert, e passa por
 * exigirOk; a recusa de quem mexe volta como { ok: false, motivo } com HTTP 200 (ver o 2_apagar_e_editar.sql).
 */
async function chamarRpc(oque, nome, args) {
  // Segredo e palavra-código nunca vão para o log, nem no erro.
  const visivel = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, (k === 'p_segredo' || k === 'p_palavra') && v != null ? '<oculto>' : v]));
  const r = await chamar(oque, `${SUPABASE.url}/rest/v1/rpc/${nome}`, {
    method: 'POST',
    headers: cabecalho({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(args),
  }, visivel);
  exigirOk(oque, r, visivel);
  let resposta = null;
  try {
    resposta = JSON.parse(r.texto);
  } catch (erro) {
    console.error(`Cadastro: a resposta ao ${oque} não era JSON.`, { texto: ocultarSegredos(r.texto.slice(0, 300)), enviado: visivel, erro });
  }
  if (!resposta || typeof resposta !== 'object' || typeof resposta.ok !== 'boolean') {
    console.error(`Cadastro: a resposta ao ${oque} não tinha o formato esperado.`, { resposta, enviado: visivel });
    throw new ErroCadastro('O banco respondeu algo que a página não entendeu. Confira se o 2_apagar_e_editar.sql foi rodado no Supabase.');
  }
  return resposta;
}

// O banco só apaga a linha; o arquivo da foto é a página que apaga, pela API do Storage. Medido em
// 02/11/2026: quando a regra do balde recusa, o Storage responde HTTP 200 com [] e nenhum erro, então
// o sucesso só se prova comparando o que voltou com o que foi pedido. Devolve os caminhos que ficaram.
async function apagarFotosDoBalde(caminhos) {
  if (!Array.isArray(caminhos) || !caminhos.length) return [];
  const oque = `apagar ${caminhos.length === 1 ? 'a foto' : 'as fotos'} do balde`;
  const pedido = { prefixes: caminhos };
  try {
    const r = await chamar(oque, `${SUPABASE.url}/storage/v1/object/${BALDE}`, {
      method: 'DELETE',
      headers: cabecalho({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(pedido),
    }, pedido);
    exigirOk(oque, r, pedido, 'foto');
    let devolvido = null;
    try {
      devolvido = JSON.parse(r.texto);
    } catch (erro) {
      console.error(`Cadastro: a resposta ao ${oque} não era JSON.`, { texto: r.texto.slice(0, 300), erro });
    }
    if (!Array.isArray(devolvido)) {
      console.error(`Cadastro: a resposta ao ${oque} não era uma lista; as fotos serão tratadas como não apagadas.`, { pedido, resposta: devolvido });
      return caminhos;
    }
    const apagados = new Set(devolvido.map((o) => o && o.name));
    const ficaram = caminhos.filter((c) => !apagados.has(c));
    if (ficaram.length) console.error(`Cadastro: o Storage não apagou ${ficaram.length} de ${caminhos.length} foto(s).`, { pedido, ficaram, resposta: devolvido });
    return ficaram;
  } catch (erro) {
    console.error(`Cadastro: falha ao ${oque}.`, { pedido, erro });
    return caminhos;
  }
}

const textoDasFotosQueFicaram = (ficaram) => (ficaram.length === 1
  ? `a foto ${ficaram[0]} ficou no balde`
  : `as fotos ${ficaram.join(', ')} ficaram no balde`);

const letrasAleatorias = (n) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
const jaExiste = ({ resp, texto }) => resp.status === 409 || (resp.status === 400 && /duplicate|already exists/i.test(texto));

async function enviarFoto(blob, caminho) {
  const tentar = (c) => chamar(`enviar a foto ${c}`, `${SUPABASE.url}/storage/v1/object/${BALDE}/${c}`, {
    method: 'POST',
    headers: cabecalho({ 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }),
    body: blob,
  }, { caminho: c, bytes: blob.size });
  let usado = caminho;
  let r = await tentar(usado);
  if (!r.resp.ok && jaExiste(r)) {
    usado = caminho.replace(/\.jpg$/, `_${letrasAleatorias(4)}.jpg`);
    console.error(`Cadastro: o nome ${caminho} já existia no balde; tentando uma vez com ${usado}.`, { status: r.resp.status, texto: r.texto });
    r = await tentar(usado);
  }
  exigirOk(`enviar a foto ${usado}`, r, { caminho: usado, bytes: blob.size }, 'foto');
  return usado;
}

/* ------------------------------------------------------------------ segredo e palavra-código, guardados no aparelho */

// O segredo nasce no aparelho, o banco recebe só o hash (SHA-256) e o link não consegue lê-lo de volta:
// quem gravou prova que é o autor mandando o segredo, sem que o banco precise guardá-lo.
function novoSegredo() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashDoSegredo(segredo) {
  const resumo = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(segredo));
  return Array.from(new Uint8Array(resumo), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Todo acesso ao localStorage é protegido: em aba anônima de alguns navegadores ele lança em vez de
// devolver vazio, e sem isto a página inteira quebraria só por não conseguir lembrar um segredo.
function lerDoAparelho(chave, oque) {
  try {
    return localStorage.getItem(chave);
  } catch (erro) {
    console.error(`Cadastro: o navegador não deixou ler ${oque} do aparelho (localStorage).`, erro);
    return null;
  }
}

function gravarNoAparelho(chave, valor, oque) {
  try {
    localStorage.setItem(chave, valor);
    return true;
  } catch (erro) {
    console.error(`Cadastro: o navegador não deixou guardar ${oque} no aparelho (localStorage).`, erro);
    return false;
  }
}

function tirarDoAparelho(chave, oque) {
  try {
    localStorage.removeItem(chave);
    return true;
  } catch (erro) {
    console.error(`Cadastro: o navegador não deixou apagar ${oque} do aparelho (localStorage).`, erro);
    return false;
  }
}

function lerSegredosGuardados() {
  const bruto = lerDoAparelho(CHAVE_SEGREDOS, 'as chaves de edição');
  if (!bruto) return {};
  try {
    const obj = JSON.parse(bruto);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    console.error('Cadastro: as chaves de edição guardadas no aparelho não eram um objeto; foram ignoradas.');
  } catch (erro) {
    console.error('Cadastro: as chaves de edição guardadas no aparelho estão corrompidas e foram ignoradas.', erro);
  }
  return {};
}

/* ------------------------------------------------------------------ foto reduzida no aparelho */

// O canvas não carrega a EXIF: o GPS e o modelo do celular de quem cadastra ficam no aparelho e não
// vão para o balde, que é público.
async function abrirImagem(arquivo) {
  try {
    const bitmap = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    return { fonte: bitmap, largura: bitmap.width, altura: bitmap.height, fechar: () => bitmap.close() };
  } catch (erro) {
    console.warn('Cadastro: createImageBitmap não abriu a foto; tentando pelo elemento <img>.', { nome: arquivo.name, tipo: arquivo.type, erro });
  }
  // O <img> já gira a foto pela EXIF no desenho em canvas dos navegadores atuais.
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { fonte: img, largura: img.naturalWidth, altura: img.naturalHeight, fechar: () => URL.revokeObjectURL(url) };
  } catch (erro) {
    URL.revokeObjectURL(url);
    throw erro;
  }
}

const paraJpeg = (canvas, qualidade) => new Promise((ok, falha) => {
  canvas.toBlob((b) => (b ? ok(b) : falha(new Error('o navegador não gerou o JPEG'))), 'image/jpeg', qualidade);
});

// Tentativas em ordem: a primeira que couber em 1.000.000 bytes (o balde aceita 1.048.576) vale.
const TENTATIVAS_FOTO = [[1600, 0.82], [1600, 0.7], [1600, 0.6], [1280, 0.7]];

async function reduzirFoto(arquivo) {
  let imagem;
  try {
    imagem = await abrirImagem(arquivo);
  } catch (erro) {
    console.error('Cadastro: a foto não abriu como imagem.', { nome: arquivo.name, tipo: arquivo.type, bytes: arquivo.size, erro });
    throw new ErroCadastro(MSG_FORMATO_FOTO, erro);
  }
  try {
    let ultimo = null;
    for (const [lado, qualidade] of TENTATIVAS_FOTO) {
      const escala = Math.min(1, lado / Math.max(imagem.largura, imagem.altura));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(imagem.largura * escala));
      canvas.height = Math.max(1, Math.round(imagem.altura * escala));
      const ctx = canvas.getContext('2d');
      // PNG com transparência viraria preto no JPEG.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imagem.fonte, 0, 0, canvas.width, canvas.height);
      ultimo = await paraJpeg(canvas, qualidade);
      canvas.width = 0;
      canvas.height = 0;
      if (ultimo.size <= LIMITE_FOTO_BYTES) return ultimo;
    }
    console.error('Cadastro: a foto não coube em 1 MB nem na menor tentativa.', { nome: arquivo.name, tipo: arquivo.type, bytes: arquivo.size, reduzida: ultimo && ultimo.size });
    throw new ErroCadastro('Não consegui reduzir esta foto para menos de 1 MB. Tente outra foto ou tire uma nova pela câmera.');
  } catch (erro) {
    if (erro instanceof ErroCadastro) throw erro;
    console.error('Cadastro: falha ao reduzir a foto no canvas.', { nome: arquivo.name, tipo: arquivo.type, bytes: arquivo.size, erro });
    throw new ErroCadastro(MSG_FORMATO_FOTO, erro);
  } finally {
    imagem.fechar();
  }
}

// Mesmo nome que o QField dá: ativo sem acento nem espaço, data e hora locais, número da foto.
function nomeDaFoto(idAtivo, n, agora) {
  const base = idAtivo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_.-]/g, '_');
  const p = (v) => String(v).padStart(2, '0');
  const dia = `${agora.getFullYear()}${p(agora.getMonth() + 1)}${p(agora.getDate())}`;
  const hora = `${p(agora.getHours())}${p(agora.getMinutes())}${p(agora.getSeconds())}`;
  return `inspecoes/${base}_${dia}_${hora}_${n}.jpg`;
}

// A data padrão é a do aparelho: toISOString() é UTC e, à noite no Brasil, já dá o dia seguinte.
function hojeLocal() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ------------------------------------------------------------------ geometria: qual ativo está sob o toque */

const M_POR_GRAU = (Math.PI / 180) * 6371008.8;

// Os polígonos ficam em [lng, lat]; a projeção local equiretangular (centrada no toque) é boa de
// sobra para os poucos centenas de metros do BRG4.
function poligonosDe(geometria) {
  if (!geometria) return [];
  if (geometria.type === 'Polygon') return [geometria.coordinates];
  if (geometria.type === 'MultiPolygon') return geometria.coordinates;
  // Em três ativos de sub-base o GeoJSON vem como coleção (polígono + pontos dos componentes);
  // só o polígono diz onde o ativo está.
  if (geometria.type === 'GeometryCollection') return geometria.geometries.flatMap(poligonosDe);
  return [];
}

function distanciaAoCandidato(c, ref) {
  const k = Math.cos((ref.lat * Math.PI) / 180) * M_POR_GRAU;
  const proj = (p) => [(p[0] - ref.lng) * k, (p[1] - ref.lat) * M_POR_GRAU];
  let melhor = Infinity;
  const aresta = (a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = dx || dy ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot(a[0] + t * dx, a[1] + t * dy);
  };
  const dentro = (anel) => {
    let d = false;
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
      const [xi, yi] = anel[i];
      const [xj, yj] = anel[j];
      if ((yi > 0) !== (yj > 0) && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) d = !d;
    }
    return d;
  };
  for (const poligono of c.poligonos) {
    const aneis = poligono.map((anel) => anel.map(proj));
    if (aneis.length && dentro(aneis[0]) && !aneis.slice(1).some(dentro)) return 0;
    for (const anel of aneis) {
      // O contorno da ponte vem sem repetir o primeiro ponto no fim: a aresta de fechamento entra aqui.
      for (let i = 0; i < anel.length; i++) melhor = Math.min(melhor, aresta(anel[(i + anel.length - 1) % anel.length], anel[i]));
    }
  }
  for (const p of c.pontos) {
    const [x, y] = proj(p);
    melhor = Math.min(melhor, Math.hypot(x, y));
  }
  return melhor;
}

// Camadas empilhadas do pavimento têm a mesma pegada: no empate vale a de cima, que é a que se vê.
const alturaNaPilha = (c) => (c.id === ID_PONTE ? 100 : ORDEM_TIPOS.indexOf(c.tipo));

function escolher(medidos) {
  return medidos.reduce((a, b) => {
    if (!a) return b;
    if (Math.abs(a.d - b.d) > 0.01) return b.d < a.d ? b : a;
    const dr = alturaNaPilha(b.c) - alturaNaPilha(a.c);
    if (dr) return dr > 0 ? b : a;
    return b.c.id < a.c.id ? b : a;
  }, null);
}

function montarCandidatos(dados) {
  const lista = [];
  const dadoDe = (chave) => (dados[chave] && dados[chave].ok ? dados[chave].dado : null);
  const area = dadoDe('area');
  const ponto = dadoDe('ponto');
  const ponte = dadoDe('ponte');
  if (area) {
    area.features.forEach((f) => lista.push({ id: f.properties.id_ativo, tipo: f.properties.tipo, poligonos: poligonosDe(f.geometry), pontos: [] }));
  } else {
    console.error('Cadastro: dados/ativos_area.geojson não carregou; o ativo mais perto será sugerido só pelos pontos e pela ponte.', dados.area && dados.area.erro);
  }
  if (ponto) {
    ponto.features.filter((f) => f.geometry && f.geometry.type === 'Point')
      .forEach((f) => lista.push({ id: f.properties.id_ativo, tipo: f.properties.tipo, poligonos: [], pontos: [f.geometry.coordinates] }));
  }
  if (ponte && Array.isArray(ponte.contorno_utm)) {
    const anel = ponte.contorno_utm.map(([leste, norte]) => {
      const { lat, lng } = utmParaLatLon(leste, norte);
      return [lng, lat];
    });
    lista.push({ id: ID_PONTE, tipo: 'Ponte', poligonos: [[anel]], pontos: [] });
  }
  return lista;
}

/* ------------------------------------------------------------------ o módulo */

const ABAS = [['visita', 'Visita'], ['achado', 'Achado'], ['fotos', 'Fotos']];
const CONDICOES = ['Boa', 'Regular', 'Ruim', 'Crítica'];

export function criarCadastro({ dados, aviso }) {
  // `segredos` espelha o localStorage: só entra aqui o segredo que o navegador de fato guardou, para
  // que "posso editar" nunca prometa o que um recarregamento da página tiraria.
  const estado = {
    linhas: [], assinantes: [], candidatos: null, ocupado: false,
    segredos: lerSegredosGuardados(), palavra: lerDoAparelho(CHAVE_DONO, 'a palavra-código do dono') || null,
    mexendo: new Set(),
  };
  const ativos = dados.ativos && dados.ativos.ok ? dados.ativos.dado.ativos : null;
  if (!ativos) console.error('Cadastro: dados/ativos.json não carregou; o formulário não consegue listar os ativos.', dados.ativos && dados.ativos.erro);

  const lista = () => [...estado.linhas];
  const doAtivo = (id) => estado.linhas.filter((l) => l.id_ativo === id);

  function avisarAssinantes(nova) {
    estado.assinantes.forEach((fn) => {
      try {
        fn(lista(), nova);
      } catch (erro) {
        console.error('Cadastro: um assinante de aoMudar falhou.', erro);
      }
    });
  }

  function aoMudar(fn) {
    estado.assinantes.push(fn);
    return () => { estado.assinantes = estado.assinantes.filter((f) => f !== fn); };
  }

  async function carregar() {
    let linhas;
    try {
      linhas = await lerLinhas();
    } catch (erro) {
      console.error('Cadastro: não consegui ler as inspeções cadastradas pelo link.', erro);
      aviso(`Não consegui ler as inspeções cadastradas pelo link: ${erro instanceof ErroCadastro ? erro.message : 'erro inesperado, veja o console.'}`);
      return;
    }
    estado.linhas = linhas;
    avisarAssinantes(null);
  }

  /* ---------- quem pode apagar e editar ---------- */

  const souDono = () => Boolean(estado.palavra);
  const segredoDe = (id) => (id != null && typeof estado.segredos[id] === 'string' ? estado.segredos[id] : null);
  const podeMexer = (linha) => Boolean(linha && (segredoDe(linha.id) || souDono()));

  function guardarSegredo(id, segredo) {
    const novos = { ...estado.segredos, [id]: segredo };
    if (!gravarNoAparelho(CHAVE_SEGREDOS, JSON.stringify(novos), 'a chave para editar a inspeção')) return false;
    estado.segredos = novos;
    return true;
  }

  function esquecerSegredo(id) {
    if (segredoDe(id) === null) return;
    const { [id]: _, ...resto } = estado.segredos;
    estado.segredos = resto;
    gravarNoAparelho(CHAVE_SEGREDOS, JSON.stringify(resto), 'a lista de chaves de edição sem a inspeção apagada');
  }

  function esquecerPalavra() {
    estado.palavra = null;
    tirarDoAparelho(CHAVE_DONO, 'a palavra-código do dono');
  }

  // O que mandar ao banco para provar quem mexe: o banco aceita qualquer um dos dois.
  const credenciais = (id) => ({ p_segredo: segredoDe(id), p_palavra: estado.palavra });

  const MSG_DONO = {
    recusado: 'Palavra-código errada.',
    bloqueado: 'Muitas tentativas erradas. Espere 10 minutos.',
    sem_palavra: 'O dono ainda não definiu a palavra-código (supabase/3_palavra_do_dono.sql).',
  };

  /** Frase para a pessoa quando apagar ou editar volta { ok: false }. Esquece a palavra que o banco não aceita mais. */
  function explicarRecusa(motivo, { id, tinhaSegredo, usouPalavra }) {
    if (motivo === 'nao_existe') return 'Esta inspeção já não está no banco (alguém apagou antes).';
    if (motivo === 'bloqueado') return 'Muitas tentativas erradas da palavra-código. Espere 10 minutos.';
    if (motivo === 'recusado' || motivo === 'sem_palavra') {
      if (!tinhaSegredo && usouPalavra) {
        esquecerPalavra();
        avisarAssinantes(null);
        return 'A palavra-código guardada neste aparelho não vale mais. Toque em Sou o dono de novo.';
      }
      return 'O banco não reconheceu a chave deste aparelho para esta inspeção. Se você é o dono, toque em Sou o dono.';
    }
    console.error('Cadastro: o banco recusou apagar ou editar com um motivo que a página não conhece.', { id, motivo });
    return `O banco recusou (motivo "${motivo}"). Atualize a página e tente de novo.`;
  }

  const dlgDono = h('dialog', { class: 'dlg dlg-dono', 'aria-label': 'Sou o dono' });
  document.body.append(dlgDono);
  dlgDono.addEventListener('close', () => dlgDono.replaceChildren());

  /** Abre a pergunta da palavra-código; ela só é guardada no aparelho depois que o banco confirma. */
  function entrarComoDono() {
    if (dlgDono.open) return;
    const campo = h('input', {
      type: 'password', id: 'dono-palavra', class: 'dono-campo', autocomplete: 'off', enterkeyhint: 'go', 'aria-describedby': 'dono-erro',
    });
    const erro = h('p', { class: 'cad-erro-campo', id: 'dono-erro', role: 'alert', hidden: true });
    const cancelar = h('button', { class: 'btn', type: 'button', onclick: () => dlgDono.close() }, 'Cancelar');
    const entrar = h('button', { class: 'btn btn-primario', type: 'submit' }, 'Entrar');
    const mostrarErro = (texto) => { erro.textContent = texto; erro.hidden = false; };
    const travarDono = (sim) => [campo, cancelar, entrar].forEach((el) => { el.disabled = sim; });

    const form = h('form', {
      class: 'dlg-cartao dono-cartao',
      novalidate: true,
      onsubmit: async (ev) => {
        ev.preventDefault();
        const palavra = campo.value;
        erro.hidden = true;
        if (!palavra) { mostrarErro('Digite a palavra-código.'); campo.focus(); return; }
        travarDono(true);
        let resposta = null;
        try {
          resposta = await chamarRpc('conferir a palavra-código do dono', 'sou_o_dono', { p_palavra: palavra });
        } catch (falha) {
          console.error('Cadastro: não consegui conferir a palavra-código do dono.', falha);
          mostrarErro(falha instanceof ErroCadastro ? falha.message : MSG_SEM_BANCO);
        }
        travarDono(false);
        if (!resposta) return;
        if (!resposta.ok) {
          if (!MSG_DONO[resposta.motivo]) console.error('Cadastro: sou_o_dono recusou com um motivo desconhecido.', { motivo: resposta.motivo });
          mostrarErro(MSG_DONO[resposta.motivo] || `O banco recusou a palavra-código (motivo "${resposta.motivo}").`);
          campo.select();
          return;
        }
        const guardou = gravarNoAparelho(CHAVE_DONO, palavra, 'a palavra-código do dono');
        estado.palavra = palavra;
        dlgDono.close();
        aviso(guardou
          ? 'Modo dono ligado neste aparelho.'
          : 'Modo dono ligado só até fechar a página: este navegador não guardou a palavra-código.');
        avisarAssinantes(null);
      },
    },
    h('div', { class: 'dlg-topo' }, h('h2', {}, 'Sou o dono')),
    h('p', { class: 'mudo' }, 'Com a palavra-código você edita e apaga qualquer inspeção cadastrada pelo link. Ela fica só neste aparelho.'),
    h('label', { class: 'link-rotulo', for: 'dono-palavra' }, 'Palavra-código'),
    campo,
    erro,
    h('div', { class: 'cad-botoes dono-botoes' }, cancelar, entrar));
    dlgDono.replaceChildren(form);
    dlgDono.showModal();
    campo.focus();
  }

  function sairDoDono() {
    esquecerPalavra();
    aviso('Modo dono desligado neste aparelho.');
    avisarAssinantes(null);
  }

  /* ---------- apagar ---------- */

  async function apagar(linha) {
    if (!linha || linha.id == null || estado.mexendo.has(linha.id)) return;
    const data = dataDaLinha(linha);
    if (!confirm(`Apagar a inspeção de ${linha.id_ativo}${data ? ` de ${dataBR(data)}` : ''}? Some para todo mundo que abre o link, com as fotos.`)) return;
    const id = linha.id;
    const quem = { id, tinhaSegredo: segredoDe(id) !== null, usouPalavra: souDono() };
    estado.mexendo.add(id);
    aviso('Apagando a inspeção…');
    try {
      let resposta;
      try {
        resposta = await chamarRpc('apagar a inspeção', 'apagar_inspecao', { p_id: id, ...credenciais(id) });
      } catch (erro) {
        console.error('Cadastro: não consegui apagar a inspeção.', { id, erro });
        aviso(erro instanceof ErroCadastro ? erro.message : 'Erro inesperado ao apagar. Veja o console do navegador.');
        return;
      }
      if (!resposta.ok) {
        console.error('Cadastro: o banco recusou apagar a inspeção.', { id, motivo: resposta.motivo });
        aviso(explicarRecusa(resposta.motivo, quem));
        if (resposta.motivo === 'nao_existe') {
          esquecerSegredo(id);
          carregar();
        }
        return;
      }
      // A linha já não existe: o que falhar daqui para a frente (as fotos) não a traz de volta.
      estado.linhas = estado.linhas.filter((l) => l.id !== id);
      esquecerSegredo(id);
      avisarAssinantes(null);
      const ficaram = await apagarFotosDoBalde(resposta.fotos);
      aviso(ficaram.length
        ? `Inspeção apagada, mas ${textoDasFotosQueFicaram(ficaram)}; o dono apaga no painel do Supabase.`
        : 'Inspeção apagada.');
    } finally {
      estado.mexendo.delete(id);
    }
  }

  function maisPerto({ lat, lng }) {
    if (!estado.candidatos) estado.candidatos = montarCandidatos(dados);
    const medidos = estado.candidatos.map((c) => ({ c, d: distanciaAoCandidato(c, { lat, lng }) })).filter((m) => Number.isFinite(m.d));
    // O terreno cobre a área toda: sem esta folga, qualquer toque perto de uma peça pequena
    // (uma boca de bueiro, um dissipador) cairia nele.
    const outro = escolher(medidos.filter((m) => m.c.tipo !== TIPO_TERRENO));
    const escolhido = outro && outro.d <= FOLGA_DO_TERRENO_M ? outro : escolher(medidos);
    return escolhido ? { id: escolhido.c.id, distanciaM: escolhido.d } : { id: null, distanciaM: null };
  }

  /* ---------- faixa "toque no ponto" ---------- */

  let faixa = null;
  function desarmar() {
    document.body.classList.remove('armando-cadastro');
    if (faixa) faixa.hidden = true;
  }
  function armar({ origem, aoCancelar }) {
    if (!faixa) {
      faixa = h('div', { class: 'faixa-cadastro', role: 'status' }, h('span', { class: 'faixa-cadastro-texto' }), h('button', { class: 'btn', type: 'button' }, 'Cancelar'));
      document.body.append(faixa);
    }
    faixa.querySelector('.faixa-cadastro-texto').textContent = `Toque no ponto do achado ${origem === '3d' ? 'no 3D' : 'no mapa'}`;
    // Reatribuir onclick troca o tratador da vez anterior, que apontava para o aoCancelar velho.
    faixa.querySelector('button').onclick = () => {
      desarmar();
      if (aoCancelar) aoCancelar();
    };
    faixa.hidden = false;
    document.body.classList.add('armando-cadastro');
  }

  /* ---------- o formulário ---------- */

  const dlg = h('dialog', { class: 'dlg dlg-cadastro', 'aria-label': 'Nova inspeção' });
  document.body.append(dlg);
  let sessao = null;

  function limparSessao() {
    if (!sessao) return;
    // A foto já enviada tem como url o endereço público do balde, que não se revoga: só a que a pessoa
    // acabou de escolher (blob) tem URL de objeto.
    sessao.fotos.forEach((f) => { if (f && f.blob && f.url) URL.revokeObjectURL(f.url); });
    sessao = null;
  }

  // O evento 'close' chega depois do close(): se abrir() já montou outra sessão, ele não pode apagá-la.
  dlg.addEventListener('close', () => { if (!dlg.open) limparSessao(); });
  // Esc passa pela mesma pergunta do botão Cancelar.
  dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); tentarFechar(); });

  function tentarFechar() {
    if (!sessao || estado.ocupado) return;
    if (assinatura() !== sessao.inicial && !confirm('Descartar o que foi preenchido?')) return;
    dlg.close();
  }

  function lerValores() {
    const c = sessao.ctl;
    const t = (n) => c[n].value.trim() || null;
    return {
      id_ativo: c.id_ativo.value || null,
      atividade: t('atividade'),
      status: c.status.value,
      data_planejada: c.data_planejada.value || null,
      data_executada: c.data_executada.value || null,
      responsavel: t('responsavel'),
      condicao: sessao.condicao,
      nao_conformidade: t('nao_conformidade'),
      servico_realizado: t('servico_realizado'),
      materiais_equipamentos: t('materiais_equipamentos'),
      decisao: c.decisao.value || null,
      proxima_data: c.proxima_data.value || null,
      custo_bruto: c.custo_rs.value.trim(),
      observacao: t('observacao'),
    };
  }

  const assinatura = () => JSON.stringify([lerValores(), sessao.fotos.map((f) => (f ? (f.caminho || f.blob.size) : 0))]);

  function limparMarcas() {
    sessao.raiz.querySelectorAll('[aria-invalid]').forEach((el) => {
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-describedby');
    });
    sessao.raiz.querySelectorAll('.cad-erro-campo').forEach((p) => { p.hidden = true; p.textContent = ''; });
  }

  function marcarErro(aba, nome, mensagem) {
    selecionarAba(aba);
    const caixa = sessao.raiz.querySelector(`#cad-${nome}-erro`);
    const alvo = sessao.ctl[nome] || sessao.raiz.querySelector(`#cad-${nome}`);
    caixa.textContent = mensagem;
    caixa.hidden = false;
    alvo.setAttribute('aria-invalid', 'true');
    alvo.setAttribute('aria-describedby', caixa.id);
    alvo.scrollIntoView({ block: 'center' });
    const foco = alvo.matches('input, select, textarea') ? alvo : alvo.querySelector('input');
    if (foco) foco.focus({ preventScroll: true });
  }

  /** Primeiro erro na ordem das abas, ou null. */
  function validar(v) {
    const c = sessao.ctl;
    const dataRuim = (nome, valor) => c[nome].validity.badInput || (valor && (valor < DATA_MIN || valor > DATA_MAX));
    const textoLongo = (valor, max) => valor && valor.length > max;
    if (!v.id_ativo) return ['visita', 'id_ativo', 'Escolha o ativo.'];
    if (textoLongo(v.atividade, 200)) return ['visita', 'atividade', 'A atividade pode ter até 200 letras.'];
    if (!v.status) return ['visita', 'status', 'Escolha o status.'];
    if (dataRuim('data_planejada', v.data_planejada)) return ['visita', 'data_planejada', 'Use uma data entre 01/01/2020 e 31/12/2040.'];
    if (dataRuim('data_executada', v.data_executada)) return ['visita', 'data_executada', 'Use uma data entre 01/01/2020 e 31/12/2040.'];
    if (textoLongo(v.responsavel, 120)) return ['visita', 'responsavel', 'O responsável pode ter até 120 letras.'];
    if (v.status === 'executada' && !v.condicao) return ['achado', 'condicao', 'Inspeção executada precisa da condição.'];
    for (const nome of ['nao_conformidade', 'servico_realizado', 'materiais_equipamentos']) {
      if (textoLongo(v[nome], 1000)) return ['achado', nome, 'Este texto pode ter até 1.000 letras.'];
    }
    if (v.status === 'executada' && !v.decisao) return ['achado', 'decisao', 'Inspeção executada precisa da decisão.'];
    if (v.decisao === 'reprogramar' && !v.proxima_data) return ['achado', 'proxima_data', 'Reprogramar é marcar a próxima data.'];
    if (dataRuim('proxima_data', v.proxima_data)) return ['achado', 'proxima_data', 'Use uma data entre 01/01/2020 e 31/12/2040.'];
    if (v.custo_bruto || c.custo_rs.validity.badInput) {
      const custo = Number(v.custo_bruto);
      if (c.custo_rs.validity.badInput || !Number.isFinite(custo) || custo < 0 || custo > 10000000) {
        return ['achado', 'custo_rs', 'O custo precisa estar entre 0 e 10.000.000.'];
      }
    }
    if (textoLongo(v.observacao, 1000)) return ['achado', 'observacao', 'A observação pode ter até 1.000 letras.'];
    return null;
  }

  function selecionarAba(nome) {
    sessao.raiz.querySelectorAll('[role="tab"]').forEach((b) => {
      const ativa = b.dataset.aba === nome;
      b.setAttribute('aria-selected', String(ativa));
      b.tabIndex = ativa ? 0 : -1;
    });
    sessao.raiz.querySelectorAll('[role="tabpanel"]').forEach((p) => { p.hidden = p.dataset.aba !== nome; });
  }

  function campo(nome, rotulo, controle, dica) {
    controle.id = `cad-${nome}`;
    controle.name = nome;
    sessao.ctl[nome] = controle;
    controle.addEventListener('input', () => {
      if (controle.getAttribute('aria-invalid') !== 'true') return;
      controle.removeAttribute('aria-invalid');
      const caixa = sessao.raiz.querySelector(`#cad-${nome}-erro`);
      caixa.hidden = true;
    });
    return h('div', { class: 'cad-campo' },
      h('label', { for: controle.id }, rotulo),
      controle,
      dica ? h('p', { class: 'cad-dica' }, dica) : null,
      h('p', { class: 'cad-erro-campo', id: `cad-${nome}-erro`, hidden: true }));
  }

  const texto = (max) => h('input', { type: 'text', maxlength: max, autocomplete: 'off', enterkeyhint: 'next' });
  const area = () => h('textarea', { maxlength: 1000, rows: 3 });
  const data = () => h('input', { type: 'date', min: DATA_MIN, max: DATA_MAX });

  function painelVisita(idInicial) {
    const ids = [...new Set([...Object.keys(ativos), ID_PONTE])].sort((a, b) => a.localeCompare(b, 'pt'));
    const rotuloDe = (id) => (id === ID_PONTE ? `${id} · Ponte` : `${id} · ${rotuloTipo(ativos[id].tipo)}`);
    const selAtivo = h('select', {}, h('option', { value: '' }, 'Escolha o ativo…'), ids.map((id) => h('option', { value: id }, rotuloDe(id))));
    selAtivo.value = idInicial && ids.includes(idInicial) ? idInicial : '';
    const sugestoes = h('datalist', { id: 'cad-tarefas' });
    const atividade = texto(200);
    atividade.setAttribute('list', 'cad-tarefas');
    const atualizarTarefas = () => {
      const a = ativos[selAtivo.value];
      const tarefas = a && a.tarefas_cobie ? a.tarefas_cobie.split(';').map((s) => s.trim()).filter(Boolean) : [];
      sugestoes.replaceChildren(...tarefas.map((t) => h('option', { value: t })));
    };
    selAtivo.addEventListener('change', atualizarTarefas);
    atualizarTarefas();
    const status = h('select', {},
      h('option', { value: 'planejada' }, 'planejada'),
      h('option', { value: 'executada' }, 'executada'),
      h('option', { value: 'não executada' }, 'não executada'));
    status.value = 'executada';
    const executada = data();
    executada.value = hojeLocal();
    return [
      campo('id_ativo', 'Ativo (ID)', selAtivo),
      campo('atividade', 'Atividade do plano', atividade, 'Sugestões vêm das tarefas do COBie do ativo; pode escrever outra.'),
      sugestoes,
      campo('status', 'Status', status),
      campo('data_planejada', 'Data planejada', data()),
      campo('data_executada', 'Data executada', executada),
      campo('responsavel', 'Responsável', texto(120)),
    ];
  }

  function painelAchado() {
    const grupo = h('fieldset', { class: 'cad-condicao', id: 'cad-condicao' }, h('legend', {}, 'Condição'));
    CONDICOES.forEach((cond) => {
      const radio = h('input', { type: 'radio', name: 'condicao', value: cond });
      // Rádio nativo não desmarca ao tocar de novo; aqui dá, porque planejada não tem condição.
      radio.addEventListener('click', () => {
        if (sessao.condicao === cond) {
          radio.checked = false;
          sessao.condicao = null;
        } else {
          sessao.condicao = cond;
        }
        grupo.removeAttribute('aria-invalid');
        sessao.raiz.querySelector('#cad-condicao-erro').hidden = true;
      });
      grupo.append(h('label', { class: 'cad-cond', estilo: { '--cor': COR_CONDICAO[cond] } }, radio, h('span', {}, cond)));
    });
    const decisao = h('select', {},
      h('option', { value: '' }, ''),
      h('option', { value: 'conservar' }, 'conservar'),
      h('option', { value: 'reparar' }, 'reparar'),
      h('option', { value: 'reprogramar' }, 'reprogramar'));
    const custo = h('input', { type: 'number', min: 0, max: 10000000, step: 0.01, inputmode: 'decimal', autocomplete: 'off' });
    return [
      h('div', { class: 'cad-campo' }, grupo, h('p', { class: 'cad-erro-campo', id: 'cad-condicao-erro', hidden: true })),
      campo('nao_conformidade', 'Não conformidade', area()),
      campo('servico_realizado', 'Serviço realizado', area()),
      campo('materiais_equipamentos', 'Materiais e equipamentos', area()),
      campo('decisao', 'Decisão (recomendação)', decisao),
      campo('proxima_data', 'Próxima data', data()),
      campo('custo_rs', 'Custo (R$)', custo),
      campo('observacao', 'Observação', area()),
    ];
  }

  function painelFotos() {
    return [1, 2].map((n) => {
      const i = n - 1;
      const entrada = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': `Foto ${n}` });
      const corpo = h('div', { class: 'cad-foto-corpo' });
      const erro = h('p', { class: 'cad-erro-campo', hidden: true });
      let vez = 0;

      const desenhar = () => {
        const f = sessao.fotos[i];
        if (!f) {
          corpo.replaceChildren(h('button', { class: 'btn', type: 'button', onclick: () => entrada.click() }, 'Tirar ou escolher foto'));
          return;
        }
        corpo.replaceChildren(
          h('img', { class: 'cad-foto-mini', src: f.url, alt: `Miniatura da foto ${n}`, width: 96, height: 96 }),
          h('div', { class: 'cad-foto-info' },
            h('p', {}, f.existente ? 'foto já enviada' : `${fmtDec(f.blob.size / 1000, 0, 0)} kB, já reduzida`),
            h('div', { class: 'cad-foto-botoes' },
              h('button', { class: 'btn', type: 'button', onclick: () => entrada.click() }, 'Trocar'),
              h('button', { class: 'btn', type: 'button', onclick: () => {
                if (f.blob && f.url) URL.revokeObjectURL(f.url);
                sessao.fotos[i] = null;
                desenhar();
              } }, 'Remover'))));
      };

      entrada.addEventListener('change', async () => {
        const arquivo = entrada.files && entrada.files[0];
        entrada.value = '';
        if (!arquivo) return;
        const minhaVez = ++vez;
        const s = sessao;
        s.emReducao += 1;
        erro.hidden = true;
        corpo.replaceChildren(h('p', { class: 'cad-foto-espera', role: 'status' }, 'Reduzindo a foto…'));
        const pendente = reduzirFoto(arquivo).then((blob) => {
          if (minhaVez !== vez || sessao !== s) return;
          const antiga = sessao.fotos[i];
          if (antiga && antiga.blob && antiga.url) URL.revokeObjectURL(antiga.url);
          sessao.fotos[i] = { blob, url: URL.createObjectURL(blob), caminho: null };
        }, (falha) => {
          if (minhaVez !== vez || sessao !== s) return;
          erro.textContent = falha instanceof ErroCadastro ? falha.message : MSG_FORMATO_FOTO;
          erro.hidden = false;
        }).then(() => {
          s.emReducao -= 1;
          if (minhaVez === vez && sessao === s) desenhar();
        });
        sessao.pendentes[i] = pendente;
        await pendente;
      });

      desenhar();
      return h('div', { class: 'cad-campo cad-foto' }, h('p', { class: 'cad-foto-rotulo' }, `Foto ${n}`), entrada, corpo, erro);
    });
  }

  function travar(sim) {
    estado.ocupado = sim;
    sessao.cartao.querySelectorAll('button, input, select, textarea').forEach((el) => { el.disabled = sim; });
    sessao.cartao.setAttribute('aria-busy', String(sim));
  }

  const progresso = (txt) => { sessao.progresso.textContent = txt; };

  function mostrarErroGeral(causa) {
    const titulo = sessao.modo === 'editar' ? 'Não gravei as alterações.' : 'Não gravei a inspeção.';
    sessao.erroGeral.replaceChildren(caixaErro({ titulo, detalhe: causa }));
    sessao.erroGeral.scrollIntoView({ block: 'nearest' });
  }

  async function gravar() {
    sessao.erroGeral.replaceChildren();
    limparMarcas();
    const v = lerValores();
    const falha = validar(v);
    if (falha) {
      marcarErro(...falha);
      return;
    }
    const editando = sessao.modo === 'editar';
    const onde = sessao.onde;
    // Na edição o ponto tocado, a origem e o segredo ficam como estavam: o banco nem os recebe (p_dados
    // só leva os campos do formulário e as fotos).
    const corpo = {
      id_ativo: v.id_ativo,
      atividade: v.atividade,
      status: v.status,
      data_planejada: v.data_planejada,
      data_executada: v.data_executada,
      responsavel: v.responsavel,
      condicao: v.condicao,
      nao_conformidade: v.nao_conformidade,
      servico_realizado: v.servico_realizado,
      materiais_equipamentos: v.materiais_equipamentos,
      decisao: v.decisao,
      proxima_data: v.proxima_data,
      custo_rs: v.custo_bruto ? Math.round(Number(v.custo_bruto) * 100) / 100 : null,
      observacao: v.observacao,
      foto_1: null,
      foto_2: null,
    };
    if (!editando) {
      Object.assign(corpo, {
        latitude: onde.lat,
        longitude: onde.lng,
        cota_m: Number.isFinite(onde.cota_m) ? onde.cota_m : null,
        origem: onde.origem === '3d' ? '3d' : 'mapa',
      });
    }
    const minha = sessao;
    const enviadas = [];
    let linha = null;
    let segredo = null;
    let ficaram = [];
    travar(true);
    try {
      if (minha.emReducao > 0) {
        progresso('Reduzindo a foto…');
        await Promise.all(minha.pendentes);
      }
      const aEnviar = minha.fotos.map((f, i) => [f, i]).filter(([f]) => f);
      const agora = new Date();
      let feitas = 0;
      for (const [f, i] of aEnviar) {
        feitas += 1;
        // Se a gravação da linha falhar e a pessoa tentar de novo, a foto que já subiu não sobe duas vezes.
        // Na edição, a foto que já estava no balde (existente) entra com o caminho dela e não sobe de novo.
        if (!f.caminho) {
          progresso(`Enviando a foto ${feitas} de ${aEnviar.length}…`);
          f.caminho = await enviarFoto(f.blob, nomeDaFoto(v.id_ativo, i + 1, agora));
        }
        corpo[`foto_${i + 1}`] = f.caminho;
        if (!f.existente) enviadas.push(f.caminho);
      }
      if (editando) {
        progresso('Gravando as alterações…');
        const id = minha.linha.id;
        const quem = { id, tinhaSegredo: segredoDe(id) !== null, usouPalavra: souDono() };
        const resposta = await chamarRpc('editar a inspeção', 'editar_inspecao', { p_id: id, p_dados: corpo, ...credenciais(id) });
        if (!resposta.ok) {
          console.error('Cadastro: o banco recusou editar a inspeção.', { id, motivo: resposta.motivo });
          if (enviadas.length) {
            console.error('Cadastro: foto(s) nova(s) já enviada(s) ficaram sem linha no banco; só o dono apaga, pelo painel do Supabase.', { caminhos: enviadas });
          }
          mostrarErroGeral(explicarRecusa(resposta.motivo, quem));
          if (resposta.motivo === 'nao_existe') {
            esquecerSegredo(id);
            carregar();
          }
          return;
        }
        linha = resposta.linha;
        const posicao = estado.linhas.findIndex((l) => l.id === id);
        if (posicao >= 0) estado.linhas[posicao] = linha;
        else estado.linhas.unshift(linha);
        if (Array.isArray(resposta.fotos) && resposta.fotos.length) {
          progresso('Apagando a foto que saiu…');
          ficaram = await apagarFotosDoBalde(resposta.fotos);
        }
      } else {
        // O segredo é novo a cada tentativa: a linha só existe depois do insert, então nenhuma tentativa
        // que falhou deixou um hash no banco.
        try {
          segredo = novoSegredo();
          corpo.segredo_hash = await hashDoSegredo(segredo);
        } catch (erro) {
          // crypto.subtle só existe em página segura (https ou localhost). Sem ele a inspeção ainda grava:
          // fica sem dono além do dono do projeto, em vez de a pessoa perder o preenchimento.
          console.error('Cadastro: o navegador não gerou o segredo de edição (crypto.subtle); a inspeção será gravada sem ele.', erro);
          segredo = null;
          delete corpo.segredo_hash;
        }
        progresso('Gravando a inspeção…');
        linha = await gravarLinha(corpo);
      }
    } catch (erro) {
      if (enviadas.length) {
        console.error('Cadastro: foto(s) já enviada(s) ficaram sem linha no banco; só o dono apaga, pelo painel do Supabase.', { caminhos: enviadas });
      }
      console.error(`Cadastro: ${editando ? 'a edição' : 'a gravação'} da inspeção falhou.`, { enviado: ocultarHash(corpo), erro });
      mostrarErroGeral(erro instanceof ErroCadastro ? erro.message : 'Erro inesperado na página. Veja o console do navegador.');
    } finally {
      if (sessao === minha) {
        progresso('');
        travar(false);
      }
    }
    if (!linha) return;
    dlg.close();
    if (editando) {
      aviso(ficaram.length
        ? `Inspeção alterada, mas ${textoDasFotosQueFicaram(ficaram)}; o dono apaga no painel do Supabase.`
        : 'Inspeção alterada.');
      avisarAssinantes(linha);
      return;
    }
    let texto = 'Inspeção gravada. Já aparece para todo mundo que abrir o link.';
    if (linha.id == null) {
      console.error('Cadastro: o banco não devolveu o id da inspeção gravada; a chave para editá-la se perdeu e só o dono edita ou apaga.');
      texto = 'Inspeção gravada. A chave para editar se perdeu; só o dono apaga.';
    } else if (!segredo || !guardarSegredo(linha.id, segredo)) {
      texto = 'Inspeção gravada. Este navegador não guardou a chave para editar; só o dono apaga.';
    }
    aviso(texto);
    estado.linhas.unshift(linha);
    avisarAssinantes(linha);
  }

  // Edição: o formulário é o mesmo da gravação, preenchido com o que a linha já tem.
  function preencher(linha) {
    const c = sessao.ctl;
    const poe = (nome, valor) => { c[nome].value = valor == null ? '' : String(valor); };
    poe('atividade', linha.atividade);
    poe('status', linha.status);
    poe('data_planejada', linha.data_planejada);
    poe('data_executada', linha.data_executada);
    poe('responsavel', linha.responsavel);
    poe('nao_conformidade', linha.nao_conformidade);
    poe('servico_realizado', linha.servico_realizado);
    poe('materiais_equipamentos', linha.materiais_equipamentos);
    poe('decisao', linha.decisao);
    poe('proxima_data', linha.proxima_data);
    poe('custo_rs', linha.custo_rs);
    poe('observacao', linha.observacao);
    sessao.condicao = linha.condicao || null;
    sessao.raiz.querySelectorAll('input[name="condicao"]').forEach((r) => { r.checked = r.value === sessao.condicao; });
  }

  function montar({ modo, linha = null, onde, idDado = null }) {
    if (dlg.open) dlg.close();
    limparSessao();
    desarmar();
    const editando = modo === 'editar';
    const perto = editando || idDado ? null : maisPerto({ lat: onde.lat, lng: onde.lng });
    const idInicial = editando ? linha.id_ativo : (idDado || (perto && perto.id));
    const { lat, lng, cota_m: cota, origem } = onde;

    // Na edição, a foto que já está no balde entra como existente: tem caminho e a url pública, e nenhum blob.
    const fotoExistente = (caminho) => (caminho ? { blob: null, url: urlDaFoto(caminho), caminho, existente: true } : null);
    sessao = {
      modo, linha, ctl: {}, fotos: editando ? [fotoExistente(linha.foto_1), fotoExistente(linha.foto_2)] : [null, null],
      emReducao: 0, pendentes: [], condicao: null, onde, inicial: '',
    };
    estado.ocupado = false;
    dlg.setAttribute('aria-label', editando ? 'Editar inspeção' : 'Nova inspeção');

    const coord = `${fmtDec(lat, 6, 6)}, ${fmtDec(lng, 6, 6)}`;
    const linhaOnde = `Tocado no ${origem === '3d' ? '3D' : 'mapa'} · ${coord}${Number.isFinite(cota) ? ` · cota ${fmtDec(cota, 2, 2)} m` : ''}`;
    let linhaAtivo = null;
    if (idDado || (perto && perto.distanciaM === 0)) linhaAtivo = `Ativo sob o toque: ${idInicial}`;
    // Um toque a 38 cm da borda do talude saiu escrito "a 0 m", que parece contradizer o "fora".
    else if (perto && perto.id) linhaAtivo = `Fora de um ativo: sugerido o mais perto, ${perto.id}, a ${perto.distanciaM < 1 ? 'menos de 1' : Math.round(perto.distanciaM)} m`;

    const paineis = [painelVisita(idInicial), painelAchado(), painelFotos()];
    const abas = h('div', { class: 'cad-abas', role: 'tablist', 'aria-label': 'Partes do formulário' }, ABAS.map(([nome, rotulo]) => h('button', {
      type: 'button', role: 'tab', class: 'cad-aba', id: `cad-aba-${nome}`, 'data-aba': nome, 'aria-controls': `cad-painel-${nome}`,
      onclick: () => selecionarAba(nome),
      onkeydown: (ev) => {
        const passo = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
        if (!passo) return;
        const proxima = ABAS[(ABAS.findIndex(([n]) => n === nome) + passo + ABAS.length) % ABAS.length][0];
        selecionarAba(proxima);
        sessao.raiz.querySelector(`#cad-aba-${proxima}`).focus();
      },
    }, rotulo)));
    const corpo = h('div', { class: 'cad-corpo' }, ABAS.map(([nome], n) => h('div', {
      role: 'tabpanel', class: 'cad-painel', id: `cad-painel-${nome}`, 'data-aba': nome, 'aria-labelledby': `cad-aba-${nome}`, hidden: true,
    }, paineis[n])));

    sessao.progresso = h('p', { class: 'cad-progresso', role: 'status', 'aria-live': 'polite' });
    sessao.erroGeral = h('div', { class: 'cad-erro-geral' });
    const cancelar = h('button', { class: 'btn', type: 'button', onclick: tentarFechar }, 'Cancelar');
    const gravarBtn = h('button', { class: 'btn btn-primario', type: 'button', onclick: gravar }, editando ? 'Gravar alterações' : 'Gravar inspeção');

    sessao.cartao = h('form', { class: 'cad-cartao', novalidate: true, onsubmit: (ev) => ev.preventDefault() },
      h('div', { class: 'cad-topo' },
        h('h2', {}, editando ? 'Editar inspeção' : 'Nova inspeção'),
        seloLink(),
        h('button', { class: 'btn-fechar', type: 'button', 'aria-label': editando ? 'Fechar sem gravar as alterações' : 'Fechar sem gravar', onclick: tentarFechar }, '×')),
      h('div', { class: 'cad-onde' }, h('p', {}, linhaOnde), linhaAtivo ? h('p', {}, linhaAtivo) : null),
      abas,
      corpo,
      h('div', { class: 'cad-pe' },
        sessao.erroGeral,
        sessao.progresso,
        h('p', { class: 'cad-aviso-pe' }, 'Fica visível para todo mundo que abrir o link. Deste aparelho você pode editar ou apagar depois.'),
        h('div', { class: 'cad-botoes' }, cancelar, gravarBtn)));
    sessao.raiz = sessao.cartao;
    dlg.replaceChildren(sessao.cartao);
    if (editando) preencher(linha);
    selecionarAba('visita');
    sessao.inicial = assinatura();
    dlg.showModal();
  }

  function abrir({ lat, lng, cota_m: cota = null, origem = 'mapa', id_ativo: idDado = null }) {
    if (!ativos) {
      aviso('Não consegui montar a lista de ativos (dados/ativos.json), então o cadastro não abre.');
      return;
    }
    montar({ modo: 'novo', onde: { lat, lng, cota_m: cota, origem }, idDado });
  }

  function editar(linha) {
    if (!ativos) {
      aviso('Não consegui montar a lista de ativos (dados/ativos.json), então a edição não abre.');
      return;
    }
    if (!linha || linha.id == null) {
      console.error('Cadastro: pediram para editar uma inspeção sem id.', { linha });
      aviso('Esta inspeção ficou sem identificação aqui na página. Recarregue a página para editar.');
      return;
    }
    montar({ modo: 'editar', linha, onde: { lat: linha.latitude, lng: linha.longitude, cota_m: linha.cota_m, origem: linha.origem } });
  }

  return {
    carregar, lista, doAtivo, aoMudar, maisPerto, abrir, armar, desarmar,
    podeMexer, editar, apagar, souDono, entrarComoDono, sairDoDono,
  };
}
