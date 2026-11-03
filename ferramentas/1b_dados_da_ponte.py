"""Tira do IFC da ponte os números reais que a ficha dela mostra.

Roda no Python do Blender, como o 1_ifc_para_glb.py (mesmo ifcopenshell do Bonsai):

    "C:/Program Files/Blender Foundation/Blender 5.1/5.1/python/bin/python.exe" -I \
        1b_dados_da_ponte.py <federado.ifc> <ponte.ifc> <dados/>

Lê, de dados/, o ativos.json (para achar a estaca da ponte no buraco entre os trechos de
pavimento) e escreve dados/ponte.json. Nada aqui é inventado: o que é fictício na ponte
(condição, inspeções, o medidor do rio) é montado pelo 2_montar_dados.py a partir deste
arquivo, e vai para o gemeo_ficticio.json.

Se o ativos.json ainda não existir, rode o 2_montar_dados.py uma vez antes: a estaca sai
dele, e o resto do ponte.json não depende disso.
"""
import collections
import glob
import json
import os
import re
import sys

pasta_libs = os.environ.get("IFCOPENSHELL_DIR") or next(iter(glob.glob(os.path.join(
    os.environ["APPDATA"], "Blender Foundation", "Blender", "*", "extensions", ".local",
    "lib", "python3.13", "site-packages"))), None)
if pasta_libs:
    sys.path.insert(0, pasta_libs)
try:
    import ifcopenshell  # noqa: E402
    import ifcopenshell.geom  # noqa: E402
    import ifcopenshell.util.element as ue  # noqa: E402
except ImportError as erro:
    sys.exit(f"Não achei o ifcopenshell (procurei em {pasta_libs!r}): {erro}. "
             "Desempacote os .whl do ifcopenshell, do shapely e do lark do Bonsai numa pasta "
             "e rode com IFCOPENSHELL_DIR apontando para ela (ver LEIA-ME).")
import numpy  # noqa: E402

if len(sys.argv) != 4:
    sys.exit(__doc__)
caminho_federado, caminho_ponte, pasta = sys.argv[1:]

federado = ifcopenshell.open(caminho_federado)
op = federado.by_type("IfcRigidOperation")[0]
origem = numpy.array([float(op.FirstCoordinate.wrappedValue),
                      float(op.SecondCoordinate.wrappedValue), float(op.Height)])
ponte = ifcopenshell.open(caminho_ponte)

config = ifcopenshell.geom.settings()
config.set("use-world-coords", True)


def vertices(modelo):
    it = ifcopenshell.geom.iterator(config, modelo, os.cpu_count() or 4)
    if not it.initialize():
        sys.exit("O ifcopenshell não conseguiu triangular nenhum elemento.")
    while True:
        forma = it.get()
        yield modelo.by_guid(forma.guid), numpy.array(forma.geometry.verts).reshape(-1, 3)
        if not it.next():
            break


pecas = list(vertices(ponte))

# ------------------------------------------------------------------ eixo e medidas
# O eixo sai das 15 vigas protendidas (as peças mais longas e alinhadas), por componentes
# principais no plano: medido em 02/11/2026, azimute 119,7°, e o tabuleiro dá 105,00 m.
vigas = [v for e, v in pecas if (e.Name or "").startswith("Viga protendida")]
if len(vigas) != 15:
    sys.exit(f"Esperava 15 vigas protendidas na ponte, achei {len(vigas)}: o IFC mudou?")
pts = numpy.vstack(vigas)[:, :2]
centro = pts.mean(0)
_, _, eixos = numpy.linalg.svd(pts - centro)
eixo, transversal = eixos[0], eixos[1]


def ao_longo(v):
    d = v[:, :2] - centro
    return d @ eixo, d @ transversal


def faixa(lista):
    v = numpy.vstack(lista)
    a, b = ao_longo(v)
    return a.min(), a.max(), b.min(), b.max(), v[:, 2].min(), v[:, 2].max()


tabuleiro = faixa([v for e, v in pecas if e.is_a("IfcCovering")])
tudo = faixa([v for _, v in pecas])
comprimento_tabuleiro = tabuleiro[1] - tabuleiro[0]
largura = tabuleiro[3] - tabuleiro[2]

# Os vãos são as vigas protendidas agrupadas pela posição ao longo do eixo: 3 grupos de 5.
# O comprimento de cada vão vem do Pset_BeamCommon.Span, que o Revit grava na viga.
grupos = collections.defaultdict(list)
for e, v in pecas:
    if (e.Name or "").startswith("Viga protendida"):
        a, _ = ao_longo(v)
        vao = ue.get_psets(e).get("Pset_BeamCommon", {}).get("Span")
        grupos[round(float(a.mean()))].append((vao, v[:, 2].min()))
vaos = [round(float(numpy.mean([s for s, _ in g])), 2) for _, g in sorted(grupos.items())]
vigas_por_vao = sorted({len(g) for g in grupos.values()})

# Fundo da viga: o menor de todos (as vigas de fora ficam mais baixas pela inclinação
# transversal do tabuleiro, 579,11 contra 579,27 no meio). É dele que se mede a altura livre.
fundo_das_vigas = float(min(z for g in grupos.values() for _, z in g))

# Fundo do vale: o menor ponto do terreno do federado sob o tabuleiro. O TIN é esparso ali
# (272 vértices numa faixa de 120 × 16 m), então é o talvegue do modelo, não um levantamento.
terreno = next((v + origem for e, v in vertices(federado) if e.is_a("IfcGeographicElement")), None)
if terreno is None:
    sys.exit("O federado não tem IfcGeographicElement: sem terreno não há altura livre.")
a, b = ao_longo(terreno)
sob = (a > tabuleiro[0]) & (a < tabuleiro[1]) & (numpy.abs(b) < largura / 2 + 2)
if not sob.any():
    sys.exit("Nenhum vértice do terreno sob a ponte: a ponte e o federado estão no mesmo lugar?")
fundo_do_vale = float(terreno[sob, 2].min())

# ------------------------------------------------------------------ estaca
# O federado não tem IfcAlignment, mas o pavimento do AIM tem dois trechos, e o buraco
# entre eles é a ponte: 5+36,132 a 6+41,129 = 104,997 m, contra 105,00 m do tabuleiro.
estaca = None
caminho_ativos = os.path.join(pasta, "ativos.json")
if os.path.exists(caminho_ativos):
    with open(caminho_ativos, encoding="utf-8") as arq:
        ativos = json.load(arq)["ativos"]

    def metros(texto):
        m = re.fullmatch(r"(\d+)\+(\d+(?:\.\d+)?)m", texto or "")
        return int(m[1]) * 100 + float(m[2]) if m else None

    trechos = sorted({(metros(x.get("estaca_inicial")), metros(x.get("estaca_final")))
                      for x in ativos.values() if metros(x.get("estaca_inicial")) is not None})
    buracos = [(f1, i2) for (_, f1), (i2, _) in zip(trechos, trechos[1:]) if i2 - f1 > 1]
    if len(buracos) == 1 and abs((buracos[0][1] - buracos[0][0]) - comprimento_tabuleiro) < 0.5:
        estaca = [round(buracos[0][0], 3), round(buracos[0][1], 3)]
    else:
        print(f"ATENÇÃO: não achei a estaca da ponte (buracos entre trechos: {buracos}, "
              f"tabuleiro {comprimento_tabuleiro:.2f} m). O ponte.json sai sem ela.")
else:
    print("ATENÇÃO: dados/ativos.json não existe; o ponte.json sai sem a estaca.")

# ------------------------------------------------------------------ peças
# Os níveis do IFC não servem para agrupar: o Revit pôs 408 pré-lajes em "01. SUPERESTRUTURA"
# e 680 em "02. MESOESTRUTURA", e os pilares em "03. INFRAESTRUTURA". O grupo vem da família.
PARTES = [
    ("Superestrutura", ("Viga protendida", "Viga Transversina", "Pre laje", "Piso",
                        "Barreira", "LAJE DE TRANSI")),
    ("Apoios", ("Aparelho Apoio", "BERÇO DE GRAUTE", "BER")),
    ("Mesoestrutura", ("Pilar", "Travessa", "Console", "Viga de Travamento")),
    ("Encontros", ("Muro Cortina", "Ala")),
    ("Fundação", ("Bloco", "Estaca")),
]
# "DNIT - Forma - Proposta" é a fôrma do Revit, não o material da peça: vigas, pilares,
# travessas e blocos chegam assim no IFC. A ficha diz isso em vez de chamar de concreto.
MATERIAL_SEM_DEFINIR = "DNIT - Forma - Proposta"

tipos = collections.OrderedDict()
for e, _ in pecas:
    familia, _, tipo = (e.Name or "").rpartition(":")[0].partition(":")
    parte = next((p for p, chaves in PARTES if any(familia.startswith(c) or c in familia
                                                    for c in chaves)), None)
    if parte is None:
        sys.exit(f"Peça da ponte sem grupo: {e.Name!r} ({e.is_a()}). Acrescente a família em PARTES.")
    mats = sorted({m.Name for m in ue.get_materials(e)} - {MATERIAL_SEM_DEFINIR})
    chave = (parte, familia, tipo)
    t = tipos.setdefault(chave, {"parte": parte, "familia": familia.replace("DNIT - ", ""),
                                 "tipo": tipo, "classe_ifc": e.is_a(), "pecas": 0,
                                 "materiais": mats})
    t["pecas"] += 1
ordem = [p for p, _ in PARTES]
lista_tipos = sorted(tipos.values(), key=lambda t: (ordem.index(t["parte"]), -t["pecas"]))

materiais = collections.Counter()
for e, _ in pecas:
    for m in {m.Name for m in ue.get_materials(e)}:
        materiais[m] += 1

# Contorno do tabuleiro com as lajes de transição, em UTM, para o mapa.
cantos = [(tudo[0], tudo[2]), (tudo[1], tudo[2]), (tudo[1], tudo[3]), (tudo[0], tudo[3])]
contorno = [(centro + a * eixo + b * transversal).round(3).tolist() for a, b in cantos]

# O meio do vão central, sob o tabuleiro: onde o 2_montar_dados.py põe o medidor do rio.
meio_central = centro + float(numpy.mean(sorted(grupos)[1:2])) * eixo


def local(e, n):
    return [round(float(e - origem[0]), 3), round(float(-(n - origem[1])), 3)]


saida = {
    "fonte": os.path.basename(caminho_ponte),
    "esquema": ponte.schema,
    "autoria": "modelo paramétrico de terceiros (Revit), o mesmo da entrega do grupo; crédito no BEP",
    "estaca_m": estaca,
    "comprimento_tabuleiro_m": round(float(comprimento_tabuleiro), 2),
    "comprimento_total_m": round(float(tudo[1] - tudo[0]), 2),
    "largura_m": round(float(largura), 2),
    "vaos_m": vaos,
    "vigas_por_vao": vigas_por_vao[0] if len(vigas_por_vao) == 1 else vigas_por_vao,
    "azimute_graus": round(float(numpy.degrees(numpy.arctan2(eixo[0], eixo[1])) % 180), 1),
    "cota_tabuleiro_m": round(float(tabuleiro[5]), 2),
    "cota_fundo_vigas_m": round(fundo_das_vigas, 2),
    "cota_fundo_vale_m": round(fundo_do_vale, 2),
    "altura_livre_m": round(fundo_das_vigas - fundo_do_vale, 2),
    "cota_ponta_estacas_m": round(float(min(v[:, 2].min() for e, v in pecas if e.is_a("IfcPile"))), 2),
    "total_pecas": len(pecas),
    "classes_ifc": dict(collections.Counter(e.is_a() for e, _ in pecas).most_common()),
    "tipos": lista_tipos,
    "materiais": dict(materiais.most_common()),
    "material_sem_definir": MATERIAL_SEM_DEFINIR,
    "centro_utm": centro.round(3).tolist(),
    "centro_xz": local(*centro),
    "meio_vao_central_utm": meio_central.round(3).tolist(),
    "meio_vao_central_xz": local(*meio_central),
    "contorno_utm": contorno,
}
with open(os.path.join(pasta, "ponte.json"), "w", encoding="utf-8") as arq:
    json.dump(saida, arq, ensure_ascii=False, indent=1)

print(f"ponte: {len(pecas)} peças, tabuleiro {comprimento_tabuleiro:.2f} × {largura:.2f} m, "
      f"vãos {vaos}, altura livre {saida['altura_livre_m']} m, estaca {estaca}")
