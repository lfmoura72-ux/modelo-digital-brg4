// Carregamento dos arquivos de dados/. Cada arquivo vem como { ok, dado } ou { ok:false, erro },
// para que uma vista com problema mostre a própria caixa de erro sem derrubar as outras.

export class ErroDeDados extends Error {
  constructor(arquivo, motivo, status = null, causa = null) {
    super(`${arquivo}: ${motivo}`);
    this.name = 'ErroDeDados';
    this.arquivo = arquivo;
    this.motivo = motivo;
    this.status = status;
    this.causa = causa;
  }
}

export const ARQUIVOS = {
  ativos: 'dados/ativos.json',
  ficticio: 'dados/gemeo_ficticio.json',
  area: 'dados/ativos_area.geojson',
  ponto: 'dados/ativos_ponto.geojson',
  ponte: 'dados/ponte.json',
  ana: 'dados/rio_piranga_ana.json',
  rio: 'dados/rio_piranga_osm.json',
  modelo: 'dados/modelo.glb',
};

export async function buscar(caminho) {
  let resp;
  try {
    resp = await fetch(caminho);
  } catch (causa) {
    throw new ErroDeDados(caminho, `a requisição falhou (${causa.message})`, null, causa);
  }
  if (!resp.ok) throw new ErroDeDados(caminho, `o servidor respondeu HTTP ${resp.status} ${resp.statusText}`.trim(), resp.status);
  return resp;
}

async function carregarJSON(caminho) {
  const resp = await buscar(caminho);
  try {
    return await resp.json();
  } catch (causa) {
    throw new ErroDeDados(caminho, `o conteúdo não é um JSON válido (${causa.message})`, resp.status, causa);
  }
}

export async function carregarTudo() {
  const chaves = ['ativos', 'ficticio', 'area', 'ponto', 'ponte', 'ana', 'rio'];
  const resultados = await Promise.allSettled(chaves.map((c) => carregarJSON(ARQUIVOS[c])));
  const dados = {};
  resultados.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      dados[chaves[i]] = { ok: true, dado: r.value };
    } else {
      console.error(`Falha ao carregar ${ARQUIVOS[chaves[i]]}:`, r.reason);
      dados[chaves[i]] = { ok: false, erro: r.reason };
    }
  });
  return dados;
}

/** Traduz um erro qualquer para os campos da caixaErro(). */
export function descreverErro(erro, arquivo) {
  const emArquivoLocal = location.protocol === 'file:';
  const nome = erro instanceof ErroDeDados ? erro.arquivo : arquivo;
  const motivo = erro instanceof ErroDeDados ? erro.motivo : (erro && erro.message) || String(erro);
  return {
    arquivo: nome,
    detalhe: `Motivo: ${motivo}.`,
    dica: emArquivoLocal
      ? 'A página foi aberta direto do arquivo (file://). Abra por um servidor: o navegador não deixa ler os dados a partir de um arquivo local.'
      : 'Confira a conexão e recarregue a página. Se o endereço estiver certo e o erro continuar, o arquivo pode não ter sido publicado.',
  };
}

/** Nomes (chaves de dados) que falharam entre os pedidos; lista vazia se estiver tudo certo. */
export function errosDe(dados, nomes) {
  return nomes.filter((n) => !dados[n].ok);
}
