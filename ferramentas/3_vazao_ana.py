"""Baixa a vazão diária do rio Piranga na ANA e grava o resumo para a ficha da ponte.

    py -3 -I 3_vazao_ana.py <pasta dados/> [--xml <arquivo.xml>]

Escreve rio_piranga_ana.json na pasta dados/. Com --xml, reprocessa um XML já baixado
em vez de ir à internet (útil para testar). O XML baixado não é guardado no projeto:
são 3,3 MB que a página não usa, e o que ela precisa está no resumo.

Estes números são REAIS, ao contrário do HID-01 (que é fictício e mora em
gemeo_ficticio.json). Por isso ficam num arquivo separado: a página põe o selo de
"fictício" em tudo que vem de gemeo_ficticio.json e o selo da ANA em tudo que vem daqui.
"""
import argparse
import calendar
import json
import math
import os
import statistics
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime

# A 56076000 que aparece no QGIS é do IGAM e a ANA responde "sem dados" de vazão para
# ela; a 56075000 tem a mesma área de drenagem e série desde 1938.
CODIGO_ESTACAO = "56075000"
URL = ("http://telemetriaws1.ana.gov.br/ServiceANA.asmx/HidroSerieHistorica"
       f"?codEstacao={CODIGO_ESTACAO}&dataInicio=&dataFim=&tipoDados=3&nivelConsistencia=")

# Um zero na vazão média diária de um rio de 4.260 km² não existe: a menor do resto da
# série é de 8,4 m³/s, em 20/10/2015. O de 10/12/2024 é falha de leitura e é o único zero medido em
# 02/11/2026 (1.053 meses, 1938-06 a 2026-02). Qualquer outro zero ou valor negativo
# pára o script em vez de sumir: pode ser dado novo da ANA, e quem decide é uma pessoa.
ZERO_CONHECIDO = date(2024, 12, 10)
ANO_DA_CHEIA_CONSULTADA = 2022

parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
parser.add_argument("pasta", help="pasta dados/, onde o JSON é gravado")
parser.add_argument("--xml", help="reprocessa este XML em vez de baixar da ANA")
args = parser.parse_args()


def falhar(msg):
    sys.exit(f"ERRO: {msg}")


def obter_xml():
    """Devolve (bytes do XML, data de quando ele foi baixado)."""
    if args.xml:
        try:
            with open(args.xml, "rb") as arq:
                return arq.read(), date.fromtimestamp(os.path.getmtime(args.xml))
        except OSError as e:
            falhar(f"não consegui ler o XML {args.xml!r} (passado em --xml): {e}. "
                   "Confira o caminho, ou rode sem --xml para baixar da ANA.")
    print(f"baixando a série da estação {CODIGO_ESTACAO} na ANA (uns 3 MB)...", flush=True)
    try:
        # A ANA demora: ~25 s medidos em 02/11/2026 para a série inteira; 180 s dá folga.
        with urllib.request.urlopen(URL, timeout=180) as resp:
            return resp.read(), date.today()
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        falhar(f"a ANA não respondeu ao baixar a vazão da estação {CODIGO_ESTACAO} "
               f"({URL}): {e!r}. Confira a internet, ou rode de novo com --xml <arquivo> "
               "se já tiver o XML baixado.")


def ler_meses(xml_bytes):
    """Um bloco SerieHistorica por mês e nível: devolve {(ano, mes, nivel): {dia: vazao}}."""
    try:
        raiz = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        falhar(f"o XML da ANA não abre ({e}). Pode ser uma página de erro no lugar da série; "
               "rode de novo mais tarde. Primeiros bytes recebidos: "
               f"{xml_bytes[:200]!r}")
    meses = {}
    for bloco in raiz.iter():
        # O XML traz o esquema (xs:element name="SerieHistorica") junto dos dados; só os
        # blocos de dado têm DataHora.
        if bloco.tag.split("}")[-1] != "SerieHistorica":
            continue
        campos = {f.tag.split("}")[-1]: (f.text or "").strip() for f in bloco}
        if "DataHora" not in campos:
            continue
        try:
            inicio = datetime.strptime(campos["DataHora"], "%Y-%m-%d %H:%M:%S")
            nivel = int(campos["NivelConsistencia"])
        except (KeyError, ValueError) as e:
            falhar(f"bloco SerieHistorica com data ou nível ilegível: {campos.get('DataHora')!r}, "
                   f"{campos.get('NivelConsistencia')!r} ({e!r}). A ANA pode ter mudado o formato.")
        chave = (inicio.year, inicio.month, nivel)
        if chave in meses:
            falhar(f"o mês {inicio:%Y-%m} aparece duas vezes no nível {nivel}. Não sei qual vale; "
                   "confira o XML.")
        dias = {}
        for dia in range(1, calendar.monthrange(inicio.year, inicio.month)[1] + 1):
            texto = campos.get(f"Vazao{dia:02d}", "")
            if texto == "":
                continue
            try:
                dias[dia] = float(texto)
            except ValueError:
                falhar(f"vazão ilegível em {inicio.year}-{inicio.month:02d}-{dia:02d}: {texto!r}.")
        meses[chave] = dias
    if not meses:
        falhar("não achei nenhum bloco SerieHistorica com dados no XML. A ANA pode ter respondido "
               "'sem dados' para a estação, ou mudado o formato; abra o XML e confira.")
    return meses


def escolher_nivel(meses):
    """Um mês, um nível: o consistido (2) quando existe, senão o bruto (1)."""
    escolhidos, brutos = {}, 0
    for (ano, mes, nivel), dias in sorted(meses.items()):
        if nivel not in (1, 2):
            falhar(f"nível de consistência {nivel} em {ano}-{mes:02d}; só conheço 1 (bruto) e "
                   "2 (consistido).")
        if (ano, mes) not in escolhidos or nivel == 2:
            escolhidos[(ano, mes)] = (nivel, dias)
    brutos = sum(1 for nivel, _ in escolhidos.values() if nivel == 1)
    return escolhidos, brutos


def serie_diaria(escolhidos):
    """Lista de (data, vazao), sem o zero de falha, e a lista dos descartados."""
    serie, descartados, suspeitos = [], [], []
    for (ano, mes), (_, dias) in sorted(escolhidos.items()):
        for dia, valor in sorted(dias.items()):
            d = date(ano, mes, dia)
            if valor <= 0:
                if d == ZERO_CONHECIDO and valor == 0:
                    descartados.append({"data": d.isoformat(), "valor": 0.0,
                                        "motivo": "vazão zero: falha de leitura (o rio não seca; "
                                                  "a menor vazão do resto da série é de 8,4 m³/s)"})
                else:
                    suspeitos.append(f"{d.isoformat()} = {valor}")
                continue
            serie.append((d, valor))
    if suspeitos:
        falhar("achei vazão zero ou negativa que não é a de 10/12/2024: "
               + "; ".join(suspeitos) + ". Não descartei nem usei: uma pessoa precisa olhar se é "
               "falha de leitura (aí entra em ZERO_CONHECIDO) ou dado novo da ANA.")
    return serie, descartados


def anos_completos(escolhidos, hidrologico):
    """Anos com os 12 meses presentes e com algum dia de vazão em cada um."""
    presentes = {}
    for (ano, mes), (_, dias) in escolhidos.items():
        if not dias:
            continue
        rotulo = ano + 1 if hidrologico and mes >= 10 else ano
        presentes.setdefault(rotulo, set()).add(mes)
    return {a for a, m in presentes.items() if len(m) == 12}


def maximas_anuais(serie, completos, hidrologico):
    """{ano: (data, valor)} da máxima diária de cada ano completo."""
    maximas = {}
    for d, v in serie:
        rotulo = d.year + 1 if hidrologico and d.month >= 10 else d.year
        if rotulo in completos and (rotulo not in maximas or v > maximas[rotulo][1]):
            maximas[rotulo] = (d, v)
    return maximas


def gumbel(maximas, retorno_anos):
    """Gumbel pelo método dos momentos sobre as máximas anuais.

    beta = s·√6/π            (s = desvio-padrão amostral das máximas)
    mu   = média − γ·beta    (γ = 0,5772157, constante de Euler)
    Q(T) = mu − beta·ln(−ln(1 − 1/T))
    """
    valores = [v for _, v in maximas.values()]
    beta = statistics.stdev(valores) * math.sqrt(6) / math.pi
    mu = statistics.fmean(valores) - 0.5772157 * beta
    return {f"{t}_anos": round(mu - beta * math.log(-math.log(1 - 1 / t)), 1)
            for t in retorno_anos}


def r1(x):
    return round(x, 1)


xml_bytes, baixado_em = obter_xml()
meses = ler_meses(xml_bytes)
escolhidos, meses_brutos = escolher_nivel(meses)
serie, descartados = serie_diaria(escolhidos)
if not serie:
    falhar("depois de descartar os zeros não sobrou nenhum dia com vazão.")

valores = [v for _, v in serie]
# Percentil 5 com interpolação linear (o padrão do numpy): a vazão igualada ou superada
# em 95% dos dias.
q95 = statistics.quantiles(valores, n=100, method="inclusive")[4]

por_mes = [[] for _ in range(12)]
for d, v in serie:
    por_mes[d.month - 1].append(v)
if any(not m for m in por_mes):
    falhar("algum mês do ano ficou sem nenhum dia de vazão; não dá para calcular a média "
           "mensal de sazonalidade.")

# Ano civil ou hidrológico? Medido em 02/11/2026, com os 86 anos que têm os 12 meses: civil
# 362,2 e hidrológico 364,7 m³/s; o civil fica mais perto dos ~363 da primeira medição.
# Esses ~363 (e o Gumbel de 598 e 928) saem exatos quando 1988 entra: são 87 anos, 362,9 e
# Gumbel 597,8 e 927,7. Mas o consistido de dez/1988 vem sem nenhum dia, então o máximo de
# 1988 pode estar subestimado; por isso 1988 fica fora, e o resultado é 362,2, 598,3 e 930,0.
candidatos = {}
for nome, hidro in (("civil", False), ("hidrologico", True)):
    completos = anos_completos(escolhidos, hidro)
    maximas = maximas_anuais(serie, completos, hidro)
    candidatos[nome] = (maximas, statistics.fmean(v for _, v in maximas.values()))
print("cheia anual média por critério de ano: "
      + "; ".join(f"{n} {m:.1f} m³/s ({len(mx)} anos)" for n, (mx, m) in candidatos.items()))

CRITERIO_ESCOLHIDO = "civil"
maximas, cheia_media = candidatos[CRITERIO_ESCOLHIDO]

maiores = sorted(maximas.items(), key=lambda kv: -kv[1][1])[:5]
dias_de_2022 = [(d, v) for d, v in serie if d.year == ANO_DA_CHEIA_CONSULTADA]
if not dias_de_2022:
    falhar(f"a série não tem nenhum dia de {ANO_DA_CHEIA_CONSULTADA}.")
data_cheia_ano, cheia_ano = max(dias_de_2022, key=lambda dv: dv[1])

resumo = {
    "fonte": {
        "orgao": "ANA, Hidroweb (HidroSerieHistorica)",
        "codigo_estacao": CODIGO_ESTACAO, "nome_estacao": "Porto Firme",
        "rio": "Piranga", "municipio": "Porto Firme", "uf": "MG",
        "area_drenagem_km2": 4260, "url": URL,
        "distancia_da_ponte": "~6 km rio abaixo", "baixado_em": baixado_em.isoformat(),
    },
    "periodo": {
        "inicio": serie[0][0].isoformat(), "fim": serie[-1][0].isoformat(),
        "meses": len(escolhidos), "meses_consistidos": len(escolhidos) - meses_brutos,
        "meses_brutos": meses_brutos, "dias_com_dado": len(serie),
    },
    "unidade": "m³/s, vazão média diária",
    "media": r1(statistics.fmean(valores)),
    "q95": r1(q95),
    "media_por_mes": [r1(statistics.fmean(m)) for m in por_mes],
    "criterio_ano": ("ano civil (jan–dez), só anos com os 12 meses" if CRITERIO_ESCOLHIDO == "civil"
                     else "ano hidrológico (out–set), só anos com os 12 meses"),
    "anos_completos": len(maximas),
    "cheia_anual_media": r1(cheia_media),
    "maiores_cheias": [{"ano": a, "data": d.isoformat(), "valor": r1(v)} for a, (d, v) in maiores],
    "cheia_de": {"ano": ANO_DA_CHEIA_CONSULTADA, "data": data_cheia_ano.isoformat(),
                 "valor": r1(cheia_ano)},
    "gumbel": gumbel(maximas, (10, 100)),
    "descartados": descartados,
}

caminho = os.path.join(args.pasta, "rio_piranga_ana.json")
try:
    with open(caminho, "w", encoding="utf-8") as arq:
        json.dump(resumo, arq, ensure_ascii=False, indent=1)
except OSError as e:
    falhar(f"não consegui gravar {caminho!r}: {e}. Confira se a pasta dados/ existe.")

p, g = resumo["periodo"], resumo["gumbel"]
print(f"\nANA {CODIGO_ESTACAO}, {resumo['fonte']['nome_estacao']} ({resumo['fonte']['rio']}), "
      f"{resumo['fonte']['area_drenagem_km2']:,} km²".replace(",", "."))
print(f"período: {p['inicio']} a {p['fim']}, {p['meses']} meses "
      f"({p['meses_consistidos']} consistidos, {p['meses_brutos']} brutos), "
      f"{p['dias_com_dado']} dias com dado")
print(f"média {resumo['media']} m³/s · Q95 {resumo['q95']} m³/s")
print(f"média de setembro {resumo['media_por_mes'][8]} m³/s · "
      f"média de janeiro {resumo['media_por_mes'][0]} m³/s")
print(f"cheia anual média {resumo['cheia_anual_media']} m³/s "
      f"({resumo['anos_completos']} anos, {resumo['criterio_ano']})")
c = resumo["cheia_de"]
print(f"cheia de {c['ano']}: {c['valor']} m³/s em {c['data']}")
print("maiores cheias: " + "; ".join(f"{m['valor']} em {m['data']}" for m in resumo["maiores_cheias"]))
print(f"Gumbel: {g['10_anos']} m³/s (10 anos) e {g['100_anos']} m³/s (100 anos)")
for dd in descartados:
    print(f"descartado: {dd['data']} = {dd['valor']} ({dd['motivo']})")
print(f"gravado em {caminho}")
