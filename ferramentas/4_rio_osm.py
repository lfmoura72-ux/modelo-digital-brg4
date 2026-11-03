"""Baixa o traçado do rio Piranga do OpenStreetMap e grava no sistema do 3D.

    py -3 -I 4_rio_osm.py <pasta dados/> [--json <resposta do Overpass.json>]

Escreve rio_piranga_osm.json na pasta dados/. Com --json, reprocessa uma resposta do
Overpass já baixada em vez de ir à internet.

Até 02/11/2026 a água do 3D era uma faixa reta de 70 x 1.400 m girada pelo eixo da ponte,
que saía do terreno nas duas pontas e cortava a foto aérea na diagonal, enquanto o Piranga
faz curva. O BRG4_AIM.gpkg não tem rio (só ativos, componentes e inspeções), e o
OpenStreetMap tem a linha de centro do Piranga (way 176297690, "Rio Piranga",
waterway=river, desenhada sobre o Bing), sem o contorno das margens: a largura é posta
pela página.

O traçado é REAL (com a precisão de quem o desenhou), a cota da água é a do HID-01, que é
fictício. Os dados do OpenStreetMap são da licença ODbL: o crédito "© colaboradores do
OpenStreetMap" vai junto no JSON e a página o mostra.
"""
import argparse
import json
import math
import sys
import urllib.parse
import urllib.request
from datetime import date

NOME_DO_RIO = "Rio Piranga"
URL = "https://overpass-api.de/api/interpreter"
# A caixa do projeto, medida nos GeoJSON em 02/11/2026, vai de -20,7226 a -20,7209 de
# latitude e de -43,1047 a -43,0977 de longitude; esta tem ~1,5 km de folga para cada lado,
# para a curva do rio entrar inteira antes de a página cortá-la na borda do terreno.
CAIXA = (-20.740, -43.125, -20.703, -43.078)
CONSULTA = (f'[out:json][timeout:60];way["waterway"="river"]["name"="{NOME_DO_RIO}"]'
            f'({CAIXA[0]},{CAIXA[1]},{CAIXA[2]},{CAIXA[3]});out tags geom;')
# Só os pontos a até 2 km da origem do modelo vão para o arquivo: o resto está fora da foto.
RAIO_UTIL_M = 2000
# A linha de centro tem de passar sob a ponte. O vão central tem 34,80 m e o fundo do vale
# é plano de -35 a +35 m do meio dele (TIN do federado); acima disso o traçado não é o
# deste rio ou está fora do lugar, e quem decide é uma pessoa.
DISTANCIA_MAXIMA_AO_VAO_M = 35.0

parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
parser.add_argument("pasta", help="pasta dados/, onde o JSON é gravado (precisa do ativos.json e do ponte.json)")
parser.add_argument("--json", help="reprocessa esta resposta do Overpass em vez de baixar")
args = parser.parse_args()


def falhar(msg):
    sys.exit(f"ERRO: {msg}")


def ler_json(caminho, para_que):
    try:
        with open(caminho, encoding="utf-8") as arq:
            return json.load(arq)
    except (OSError, json.JSONDecodeError) as e:
        falhar(f"não consegui ler {caminho} ({para_que}): {e}")


def obter_resposta():
    if args.json:
        return ler_json(args.json, "a resposta do Overpass passada em --json"), "arquivo --json"
    print(f"baixando o traçado do {NOME_DO_RIO} do OpenStreetMap (Overpass)...", flush=True)
    corpo = urllib.parse.urlencode({"data": CONSULTA}).encode()
    pedido = urllib.request.Request(URL, data=corpo, headers={"User-Agent": "gemeo-digital-brg4 (TFM Zigurat)"})
    try:
        # O Overpass respondeu em ~3 s em 02/11/2026; 90 s cobre um servidor cheio.
        with urllib.request.urlopen(pedido, timeout=90) as resp:
            return json.loads(resp.read().decode("utf-8")), URL
    except Exception as e:  # rede, HTTP 429/504 do Overpass, resposta que não é JSON
        falhar(f"o Overpass não entregou o traçado ({type(e).__name__}: {e}). Consulta enviada: {CONSULTA}. "
               "Se for 429, 502 ou 504, o servidor está cheio: tente de novo em alguns minutos.")


# UTM direto (série de Snyder), zona 23 sul, WGS84: o inverso do js/utm.js. Sem pyproj, que
# não está no Python desta máquina.
A = 6378137.0
F = 1 / 298.257223563
K0 = 0.9996
E2 = F * (2 - F)
EP2 = E2 / (1 - E2)


def latlon_para_utm(lat, lon, zona=23):
    phi = math.radians(lat)
    lam = math.radians(lon)
    lam0 = math.radians(zona * 6 - 183)
    n = A / math.sqrt(1 - E2 * math.sin(phi) ** 2)
    t = math.tan(phi) ** 2
    c = EP2 * math.cos(phi) ** 2
    a = math.cos(phi) * (lam - lam0)
    m = A * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * phi
             - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * math.sin(2 * phi)
             + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * math.sin(4 * phi)
             - (35 * E2 ** 3 / 3072) * math.sin(6 * phi))
    leste = K0 * n * (a + (1 - t + c) * a ** 3 / 6 + (5 - 18 * t + t ** 2 + 72 * c - 58 * EP2) * a ** 5 / 120) + 500000
    norte = K0 * (m + n * math.tan(phi) * (a ** 2 / 2 + (5 - t + 9 * c + 4 * c ** 2) * a ** 4 / 24
                                           + (61 - 58 * t + t ** 2 + 600 * c - 330 * EP2) * a ** 6 / 720))
    return leste, norte + 10000000  # hemisfério sul


def distancia_ponto_segmento(p, a, b):
    ax, az = a
    bx, bz = b
    dx, dz = bx - ax, bz - az
    comprimento2 = dx * dx + dz * dz
    k = 0.0 if comprimento2 == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - az) * dz) / comprimento2))
    return math.hypot(p[0] - (ax + k * dx), p[1] - (az + k * dz))


ativos = ler_json(f"{args.pasta}/ativos.json", "para a origem_utm do modelo")
ponte = ler_json(f"{args.pasta}/ponte.json", "para o meio do vão central")
leste0, norte0 = ativos["origem_utm"][0], ativos["origem_utm"][1]
meio = ponte["meio_vao_central_xz"]

resposta, origem_da_resposta = obter_resposta()
caminhos = [e for e in resposta.get("elements", []) if e.get("type") == "way" and e.get("tags", {}).get("name") == NOME_DO_RIO]
if len(caminhos) != 1:
    achados = [(e.get("id"), e.get("tags")) for e in resposta.get("elements", [])]
    falhar(f"esperava 1 caminho '{NOME_DO_RIO}' na caixa {CAIXA}, achei {len(caminhos)}: {achados}. "
           "Se o OpenStreetMap partiu o rio em vários pedaços, eles precisam ser emendados aqui.")
caminho = caminhos[0]

pontos = []
for nó in caminho.get("geometry", []):
    leste, norte = latlon_para_utm(nó["lat"], nó["lon"])
    x, z = leste - leste0, -(norte - norte0)
    if math.hypot(x, z) <= RAIO_UTIL_M:
        pontos.append([round(x, 2), round(z, 2)])
if len(pontos) < 2:
    falhar(f"o caminho {caminho['id']} tem {len(caminho.get('geometry', []))} pontos, e só {len(pontos)} a até {RAIO_UTIL_M} m do modelo.")

# Pontos fora do raio no meio do caminho fariam a linha pular; confere que o trecho é contínuo.
for a, b in zip(pontos, pontos[1:]):
    if math.hypot(b[0] - a[0], b[1] - a[1]) > 300:
        falhar(f"há um salto de mais de 300 m entre {a} e {b}: o rio sai e volta do raio de {RAIO_UTIL_M} m, e o recorte precisa ser outro.")

distancia = min(distancia_ponto_segmento(meio, a, b) for a, b in zip(pontos, pontos[1:]))
print(f"{len(pontos)} pontos do caminho {caminho['id']} a até {RAIO_UTIL_M} m; a linha de centro passa a {distancia:.1f} m do meio do vão central.")
if distancia > DISTANCIA_MAXIMA_AO_VAO_M:
    falhar(f"a linha de centro passa a {distancia:.1f} m do meio do vão central (limite {DISTANCIA_MAXIMA_AO_VAO_M} m): "
           "ou não é este rio, ou o desenho do OpenStreetMap está deslocado. Confira sobre a foto aérea antes de usar.")

saida = {
    "nome": NOME_DO_RIO,
    "fonte": "OpenStreetMap",
    "credito": "© colaboradores do OpenStreetMap (ODbL)",
    "osm_way": caminho["id"],
    "tags": caminho.get("tags", {}),
    "baixado_em": date.today().isoformat(),
    "consulta": CONSULTA if origem_da_resposta == URL else f"reprocessado de {args.json}",
    "sistema": "x = leste - origem_utm[0], z = -(norte - origem_utm[1]), em metros, como o modelo.glb",
    "distancia_ao_meio_do_vao_m": round(distancia, 1),
    "pontos_xz": pontos,
}
destino = f"{args.pasta}/rio_piranga_osm.json"
with open(destino, "w", encoding="utf-8") as arq:
    json.dump(saida, arq, ensure_ascii=False, indent=1)
print(f"gravado {destino}")
