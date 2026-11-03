"""Converte os IFC do BRG4 num GLB que o navegador do celular abre.

Roda no Python do Blender, porque quem lê geometria IFC nesta máquina é o
ifcopenshell do addon Bonsai:

    "C:/Program Files/Blender Foundation/Blender 5.1/5.1/python/bin/python.exe" -I \
        1_ifc_para_glb.py <federado.ifc> <ponte.ifc> <saida.glb> <saida_elementos.json>

Por que GLB e não o IFC direto na página: ler IFC no navegador exige carregar um
interpretador inteiro (web-ifc, ~4 MB de WASM) e refazer a triangulação no
celular a cada abertura. O GLB já vem triangulado: o celular só desenha.

Se a variável IFCOPENSHELL_DIR existir, o ifcopenshell vem dela. Em 02/11/2026 a
pasta site-packages do Bonsai estava vazia (só __pycache__) e o ifcopenshell só
existia como .whl dentro de extensions/blender_org/bonsai/wheels; desempacotar o
.whl numa pasta e apontar IFCOPENSHELL_DIR para ela resolve sem mexer no Blender.
"""
import glob
import json
import os
import struct
import sys

pasta_libs = os.environ.get("IFCOPENSHELL_DIR") or next(iter(glob.glob(os.path.join(
    os.environ["APPDATA"], "Blender Foundation", "Blender", "*", "extensions", ".local",
    "lib", "python3.13", "site-packages"))), None)
if pasta_libs:
    sys.path.insert(0, pasta_libs)
try:
    import ifcopenshell  # noqa: E402
    import ifcopenshell.geom  # noqa: E402
except ImportError as erro:
    sys.exit(f"Não achei o ifcopenshell (procurei em {pasta_libs!r}): {erro}. "
             "Desempacote o ifcopenshell-*.whl do Bonsai numa pasta e rode com "
             "IFCOPENSHELL_DIR apontando para ela.")
import numpy  # noqa: E402

if len(sys.argv) != 5:
    sys.exit(__doc__)
caminho_federado, caminho_ponte, caminho_glb, caminho_json = sys.argv[1:]

federado = ifcopenshell.open(caminho_federado)
ops = federado.by_type("IfcRigidOperation")
if len(ops) != 1:
    sys.exit(f"Esperava 1 IfcRigidOperation em {caminho_federado}, achei {len(ops)}.")
op = ops[0]
# No federado a geometria é local e a IfcRigidOperation leva para UTM: E 697587,057 /
# N 7707428,509 / cota 580,848, medido em 02/11/2026. A ponte (Revit) já vem em UTM
# absoluto — E 697491 a 697597, cota 551 a 582 — então a origem do 3D é a do federado,
# e a ponte é que recebe a subtração.
origem = numpy.array([float(op.FirstCoordinate.wrappedValue),
                      float(op.SecondCoordinate.wrappedValue),
                      float(op.Height)])

config = ifcopenshell.geom.settings()
config.set("use-world-coords", True)


def formas(modelo):
    it = ifcopenshell.geom.iterator(config, modelo, os.cpu_count() or 4)
    if not it.initialize():
        sys.exit("O ifcopenshell não conseguiu triangular nenhum elemento.")
    while True:
        forma = it.get()
        g = forma.geometry
        yield (modelo.by_guid(forma.guid),
               numpy.array(g.verts, dtype=numpy.float64).reshape(-1, 3),
               numpy.array(g.normals, dtype=numpy.float32).reshape(-1, 3),
               numpy.array(g.faces, dtype=numpy.uint32).reshape(-1, 3))
        if not it.next():
            break


malhas = []      # (nome do nó, vértices em UTM relativo, normais, faces)
elementos = {}

for el, v, n, f in formas(federado):
    malhas.append((el.GlobalId, v, n, f))
    elementos[el.GlobalId] = {"classe": el.is_a(), "nome": el.Name, "fonte": "federado"}

# A ponte tem 1.254 peças (1.090 lajes). Sem ficha de ativo, não há o que tocar
# nelas uma a uma; juntar por classe deixa 6 malhas em vez de 1.254 desenhos por
# quadro, o que pesa no celular.
ponte = ifcopenshell.open(caminho_ponte)
por_classe = {}
for el, v, n, f in formas(ponte):
    # Subtrair aqui, em float64: gravado em float32 a 7.707.000 m de norte, o passo do
    # número é 0,5 m, e o bueiro de 0,8 m saía serrilhado (GLB de 02/11/2026, 1ª versão).
    por_classe.setdefault(el.is_a(), []).append((v - origem, n, f))
for classe, partes in sorted(por_classe.items()):
    vs, ns, fs, base = [], [], [], 0
    for v, n, f in partes:
        vs.append(v)
        ns.append(n)
        fs.append(f + base)
        base += len(v)
    nome = f"PONTE_{classe}"
    malhas.append((nome, numpy.vstack(vs), numpy.vstack(ns), numpy.vstack(fs)))
    elementos[nome] = {"classe": classe, "nome": f"Ponte: {classe} ({len(partes)} peças)",
                       "fonte": "ponte"}

# glTF é Y para cima e Z para a tela: leste → x, cota → y, norte → −z.
corpo = bytearray()
gltf = {"asset": {"version": "2.0", "generator": "gemeo-digital-brg4/1_ifc_para_glb.py"},
        "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [],
        "accessors": [], "bufferViews": [], "buffers": [],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [0.8, 0.8, 0.8, 1],
                                                "metallicFactor": 0, "roughnessFactor": 0.9}}],
        "extras": {"origem_utm": origem.tolist(), "crs": "EPSG:32723"}}


def bloco(dados, alvo, tipo, componente, contagem, minimo=None, maximo=None):
    while len(corpo) % 4:
        corpo.append(0)
    gltf["bufferViews"].append({"buffer": 0, "byteOffset": len(corpo),
                                "byteLength": len(dados), "target": alvo})
    corpo.extend(dados)
    acc = {"bufferView": len(gltf["bufferViews"]) - 1, "componentType": componente,
           "count": contagem, "type": tipo}
    if minimo is not None:
        acc["min"], acc["max"] = minimo, maximo
    gltf["accessors"].append(acc)
    return len(gltf["accessors"]) - 1


for nome, v, n, f in malhas:
    if not len(f):
        continue
    # Tudo aqui já é relativo à origem: o federado nasce local, e a ponte foi subtraída acima.
    pos = numpy.column_stack([v[:, 0], v[:, 2], -v[:, 1]]).astype(numpy.float32)
    i_pos = bloco(pos.tobytes(), 34962, "VEC3", 5126, len(pos),
                  pos.min(0).tolist(), pos.max(0).tolist())
    atributos = {"POSITION": i_pos}
    # O iterador do ifcopenshell 0.8.5 devolveu normais vazias nas 94 malhas (02/11/2026);
    # acessor NORMAL com contagem 0 é GLB inválido, então só grava quando elas vêm.
    if len(n) == len(v):
        nor = numpy.column_stack([n[:, 0], n[:, 2], -n[:, 1]]).astype(numpy.float32)
        atributos["NORMAL"] = bloco(nor.tobytes(), 34962, "VEC3", 5126, len(nor))
    i_idx = bloco(f.astype(numpy.uint32).ravel().tobytes(), 34963, "SCALAR", 5125, f.size)
    gltf["meshes"].append({"primitives": [{"attributes": atributos,
                                           "indices": i_idx, "material": 0}]})
    gltf["nodes"].append({"name": nome, "mesh": len(gltf["meshes"]) - 1})
    gltf["scenes"][0]["nodes"].append(len(gltf["nodes"]) - 1)

while len(corpo) % 4:
    corpo.append(0)
gltf["buffers"].append({"byteLength": len(corpo)})
js = json.dumps(gltf, separators=(",", ":")).encode()
js += b" " * (-len(js) % 4)
with open(caminho_glb, "wb") as arq:
    arq.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(corpo)))
    arq.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
    arq.write(struct.pack("<II", len(corpo), 0x004E4942) + corpo)

with open(caminho_json, "w", encoding="utf-8") as arq:
    json.dump({"origem_utm": origem.tolist(), "crs": "EPSG:32723", "elementos": elementos},
              arq, ensure_ascii=False, indent=1)

n_tri = sum(len(m[3]) for m in malhas)
print(f"{len(gltf['nodes'])} malhas, {n_tri} triângulos, "
      f"{os.path.getsize(caminho_glb) / 1e6:.1f} MB em {caminho_glb}")
print(f"origem UTM {origem.round(3).tolist()}; ponte em {len(por_classe)} classes")
