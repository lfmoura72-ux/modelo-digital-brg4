"""Junta o que é real (IFC, COBie, GeoPackage) e o que é fictício num só arquivo.

    py -3 -I 2_montar_dados.py <pasta dados/>

Lê, da pasta dados/: ativos_area.geojson, ativos_ponto.geojson e componentes.csv
(saídos do BRG4_AIM.gpkg pelo ogr2ogr, ver LEIA-ME) e elementos_ifc.json (saído do
1_ifc_para_glb.py). Escreve ativos.json e gemeo_ficticio.json.

O que é fictício mora num arquivo separado de propósito: a página mostra o selo
"fictício" em tudo que vem de gemeo_ficticio.json, e nada que vem de ativos.json
leva esse selo. Misturar os dois num arquivo só tornaria impossível a página dizer,
com certeza, qual número é do modelo e qual é inventado.
"""
import csv
import json
import math
import os
import re
import sys

if len(sys.argv) != 2:
    sys.exit(__doc__)
pasta = sys.argv[1]


def ler_json(nome):
    with open(os.path.join(pasta, nome), encoding="utf-8") as arq:
        return json.load(arq)


ifc = ler_json("elementos_ifc.json")
origem_e, origem_n, origem_h = ifc["origem_utm"]

ativos = {}
for camada in ("ativos_ponto", "ativos_area"):
    for f in ler_json(f"{camada}.geojson")["features"]:
        p = f["properties"]
        ativos[p["id_ativo"]] = {**p, "geometria": "ponto" if camada == "ativos_ponto" else "area",
                                 "guids": []}

guid_para_ativo = {}
sem_ativo = []
with open(os.path.join(pasta, "componentes.csv"), encoding="utf-8") as arq:
    for c in csv.DictReader(arq):
        if c["id_ativo"] not in ativos:
            sem_ativo.append(c["id_componente"])
            continue
        ativos[c["id_ativo"]]["guids"].append(c["guid_ifc"])
        guid_para_ativo[c["guid_ifc"]] = c["id_ativo"]

# Elemento do IFC que não é componente de nenhum ativo: a página mostra a classe IFC
# e diz que ele não tem ficha, em vez de inventar uma.
fora_do_aim = {g: e for g, e in ifc["elementos"].items() if g not in guid_para_ativo}

with open(os.path.join(pasta, "ativos.json"), "w", encoding="utf-8") as arq:
    json.dump({"origem_utm": ifc["origem_utm"], "crs": ifc["crs"], "ativos": ativos,
               "guid_para_ativo": guid_para_ativo, "fora_do_aim": fora_do_aim},
              arq, ensure_ascii=False, indent=1)


def local(e, n):
    """UTM → coordenada do 3D (x = leste, z = −norte, a partir da origem do federado)."""
    return [round(e - origem_e, 3), round(-(n - origem_n), 3)]


# ------------------------------------------------------------------ fictício
# Datas: a operação começa em janeiro de 2027, como nas notas do slide 3 (M3 = março).
# Coordenadas UTM medidas no BRG4_AIM.gpkg em 02/11/2026: a boca 005 fica a 2,4 m do
# dissipador, então é a saída (o dissipador vai a jusante); a 004 é a entrada.
BOCA_SAIDA = (698020.719, 7707550.964)
BOCA_ENTRADA = (698036.319, 7707521.509)
TALUDE_CORTE = (697816.551, 7707455.745)   # ST_PointOnSurface do CORTE_001

inspecoes = [
    # A primeira é a do slide 3, campo a campo (acrescentar_slide3_parte05.py).
    {"id_ativo": "BUEIRO_001", "atividade": "Inspeção de drenagem (M3 do plano)",
     "data_planejada": "2027-03-15", "data_executada": "2027-03-16",
     "responsavel": "Equipe de conservação 01", "condicao": "Regular",
     "nao_conformidade": "assoreamento parcial na boca de entrada",
     "servico_realizado": "nenhum (só inspeção)", "decisao": "conservar",
     "proxima_data": "2027-09-15", "status": "executada", "custo_rs": None,
     "foto_1": "BUEIRO_001_20270316_1.jpg", "observacao": "a limpeza de M8 já está no plano",
     "local": "entrada"},
    {"id_ativo": "BUEIRO_001", "atividade": "Limpeza de bueiro (M8 do plano)",
     "data_planejada": "2027-08-15", "data_executada": "2027-08-19",
     "responsavel": "Equipe de conservação 01", "condicao": "Boa",
     "nao_conformidade": None,
     "servico_realizado": "remoção do assoreamento e desobstrução da boca de entrada",
     "decisao": "conservar", "proxima_data": "2027-09-15", "status": "executada",
     "custo_rs": 1850.00, "foto_1": "BUEIRO_001_20270819_1.jpg",
     "observacao": "materiais: caminhão basculante, retroescavadeira", "local": "entrada"},
    {"id_ativo": "BUEIRO_001", "atividade": "Inspeção de drenagem (M9 do plano)",
     "data_planejada": "2027-09-15", "data_executada": "2027-09-15",
     "responsavel": "Equipe de conservação 01", "condicao": "Ruim",
     "nao_conformidade": "erosão no pé do dissipador e fissura na ala da boca de saída",
     "servico_realizado": "nenhum (só inspeção)", "decisao": "reparar",
     # status só aceita planejada · executada · não executada (DECISOES.md, 01/11/2026):
     # a ordem de serviço é da patologia, não da visita.
     "proxima_data": "2027-10-20", "status": "executada", "custo_rs": None,
     "foto_1": "BUEIRO_001_20270915_1.jpg",
     "observacao": "OS-2027-014: recompor a ala e o enrocamento do dissipador antes das chuvas",
     "local": "saida"},
]

patologia = {
    "id": "PAT-2027-003", "id_ativo": "BUEIRO_001",
    "titulo": "Fissura na ala da boca de saída",
    "descricao": "Fissura de ~2 mm na ala esquerda da boca de saída, com erosão do solo "
                 "no pé do dissipador de energia.",
    "gravidade": "Ruim", "aberta_em": "2027-09-15", "ordem_servico": "OS-2027-014",
    "prazo": "2027-10-20", "utm": list(BOCA_SAIDA), "xz": local(*BOCA_SAIDA),
}

# Uma leitura por semana, de 04/01 a 20/09/2027. A chuva segue o regime da Zona da Mata
# mineira (verão chuvoso, inverno seco), digitada à mão para o exemplo; o deslocamento
# cresce com a chuva: 0,012 mm por mm de chuva mais 0,05 mm de fluência por semana.
chuva_semanal_mm = [82, 95, 70, 88, 64, 90, 76, 58, 72, 60, 48, 55, 40,   # jan–mar
                    35, 22, 28, 18,                                        # abr
                    9, 6, 4, 2, 0, 3, 0, 1, 0, 0, 2, 0, 4, 0, 1, 0, 6,    # mai–ago
                    12, 8, 18, 15]                                         # set
leituras, acumulado = [], 0.0
from datetime import date, timedelta  # noqa: E402
for i, chuva in enumerate(chuva_semanal_mm):
    acumulado += 0.012 * chuva + 0.05
    leituras.append({"data": (date(2027, 1, 4) + timedelta(weeks=i)).isoformat(),
                     "deslocamento_mm": round(acumulado, 2), "chuva_mm": chuva})

sensor = {
    "id": "INC-01", "id_ativo": "CORTE_001",
    "tipo": "Inclinômetro com transmissão remota",
    "mede": "deslocamento horizontal acumulado do talude, a 6 m de profundidade",
    "limite_atencao_mm": 10, "limite_alerta_mm": 25,
    "bateria_pct": 78, "ultima_transmissao": "2027-09-20T06:00",
    "utm": list(TALUDE_CORTE), "xz": local(*TALUDE_CORTE),
    "leituras": leituras,
}

# A próxima inspeção de cada ativo, planejada (escolha do dono em 02/11/2026: sem ela, 54
# das 55 fichas diziam "nenhuma inspeção registrada"). O intervalo é real, do COBie: a
# tarefa de menor intervalo, contada a partir da situação simulada. Só a data é inventada,
# por isso mora aqui e sai com o selo. Fica fora de `inspecoes` de propósito: aquela lista
# é o histórico executado, e a linha do tempo do Painel a mostra inteira.
DATA_SIMULADA = date(2027, 9, 20)


def somar_meses(d, meses):
    m = d.month - 1 + meses
    return d.replace(year=d.year + m // 12, month=m % 12 + 1)   # dia 20 existe em todo mês


proximas = []
for id_ativo, a in sorted(ativos.items()):
    # "Limpeza de bueiro a cada 6 meses; Inspeção estrutural a cada 12 meses"
    tarefas = [re.fullmatch(r"(.+?) a cada (\d+) meses", t.strip())
               for t in (a.get("tarefas_cobie") or "").split(";") if t.strip()]
    if not tarefas or None in tarefas:
        sys.exit(f"ERRO ao planejar a próxima inspeção de {id_ativo}: não li as tarefas do COBie "
                 f"{a.get('tarefas_cobie')!r} no formato '<tarefa> a cada <N> meses'. "
                 "Sem isso a ficha ficaria sem inspeção; confira a coluna tarefas_cobie do AIM.")
    atividade, meses = min(((t[1], int(t[2])) for t in tarefas), key=lambda t: t[1])
    if meses != a.get("menor_intervalo_meses"):
        sys.exit(f"ERRO em {id_ativo}: a menor tarefa do COBie é de {meses} meses, mas o AIM diz "
                 f"menor_intervalo_meses = {a.get('menor_intervalo_meses')}. As duas colunas "
                 "deveriam concordar; confira o BRG4_AIM.gpkg antes de seguir.")
    proximas.append({"id_ativo": id_ativo, "atividade": atividade, "intervalo_meses": meses,
                     "data_planejada": somar_meses(DATA_SIMULADA, meses).isoformat(),
                     "data_executada": None, "responsavel": "Equipe de conservação 01",
                     "condicao": None, "status": "planejada"})

# ------------------------------------------------------------------ o rio sob a ponte
# Não há estudo hidrológico da ponte (escolha do dono em 02/11/2026: tudo inventado e
# plausível). O que é real são as duas cotas, do ponte.json: o fundo das vigas (579,11) e
# o fundo do vale no TIN do federado (571,01). O medidor é um radar preso sob o tabuleiro,
# então mede direto a distância até a água — a altura livre, que é o que importa para a
# ponte (galhada e cheia batendo na viga).
if not os.path.exists(os.path.join(pasta, "ponte.json")):
    sys.exit("ERRO: falta dados/ponte.json. Rode antes o ferramentas/1b_dados_da_ponte.py "
             "(ver LEIA-ME): as cotas do medidor do rio saem dele.")
ponte = ler_json("ponte.json")
fundo_vigas, fundo_vale = ponte["cota_fundo_vigas_m"], ponte["cota_fundo_vale_m"]

# A mesma chuva do INC-01, para as duas histórias baterem: o rio sobe com a chuva da semana
# e desce pela metade a cada semana seca (0,55 de recessão, 0,02 m por mm). Lâmina de
# estiagem de 0,55 m. Calibrado em 02/11/2026: atenção de 25/01 a 01/03, sem alerta, e
# 6,95 m de folga em 20/09.
# A vazão sai de uma curva-chave inventada, Q = 63·h^(5/3). A primeira, 9·h^1,65, dava 3,5 m³/s
# na seca e 91,9 no pico, vazão de córrego, e o dono recusou para uma ponte de 105 m. Esta é a
# de Manning num canal largo: o TIN dá fundo de ~571 por uns 70 m (de −35 a +35 m do centro),
# e com n = 0,035 e declividade de 0,1%, 70·√0,001/0,035 = 63. Medido em 02/11/2026: 24,6 m³/s
# na semana mais seca e 655,2 no pico, em 08/02 (a mesma semana da menor altura livre).
# Conferido contra o rio de verdade, que é o Piranga: a estação 56075000 da ANA (Porto Firme,
# 4.260 km², 6 km rio abaixo da ponte), série diária de 1938-06 a 2026-02 baixada do
# HidroSerieHistorica em 02/11/2026, dá Q95 de 23,9 m³/s, média de 70,2, cheia de 665 em
# 11/01/2022 e a maior, 1.075, em 03/01/2012. A curva não foi ajustada à estação: só bate com ela.
LAMINA_ESTIAGEM, RECESSAO, SUBIDA_POR_MM = 0.55, 0.55, 0.02
CURVA_CHAVE_COEF, CURVA_CHAVE_EXP = 63.0, 5 / 3
ATENCAO_RIO_M, ALERTA_RIO_M = 4.5, 3.0
leituras_rio, subida = [], 0.0
for l in leituras:
    subida = RECESSAO * subida + SUBIDA_POR_MM * l["chuva_mm"]
    lamina = LAMINA_ESTIAGEM + subida
    leituras_rio.append({"data": l["data"], "chuva_mm": l["chuva_mm"],
                         "nivel_m": round(fundo_vale + lamina, 2),
                         "altura_livre_m": round(fundo_vigas - fundo_vale - lamina, 2),
                         "vazao_m3s": round(CURVA_CHAVE_COEF * lamina ** CURVA_CHAVE_EXP, 1)})
em_atencao = [l["data"] for l in leituras_rio if l["altura_livre_m"] <= ATENCAO_RIO_M]
if not em_atencao or any(l["altura_livre_m"] <= ALERTA_RIO_M for l in leituras_rio):
    sys.exit("ERRO: a série do rio deveria ter um período de atenção e nenhum alerta (a história "
             "da inspeção extraordinária da ponte depende disso). Confira as constantes acima.")

sensor_rio = {
    "id": "HID-01", "onde": "ponte",
    "tipo": "Sensor de nível por radar, preso sob o tabuleiro no meio do vão central",
    "mede": "a altura livre entre o fundo das vigas e a água, e a vazão pela curva-chave",
    "cota_fundo_vigas_m": fundo_vigas, "cota_fundo_vale_m": fundo_vale,
    "limite_atencao_m": ATENCAO_RIO_M, "limite_alerta_m": ALERTA_RIO_M,
    "bateria_pct": 91, "ultima_transmissao": "2027-09-20T06:00",
    "utm": ponte["meio_vao_central_utm"], "xz": ponte["meio_vao_central_xz"],
    "leituras": leituras_rio,
}

# A operação da ponte. Ela não tem ficha no AIM nem tarefa no COBie, então tudo aqui é
# inventado, inclusive a manutenção prevista. A extraordinária é a consequência da cheia
# do HID-01: a data sai da última semana em atenção, não de uma data digitada à mão.
inicio_cheia = date.fromisoformat(em_atencao[0])
fim_cheia = date.fromisoformat(em_atencao[-1])
ponte_ficticia = {
    "id": "OAE-01", "condicao": "Boa",
    "manutencao_prevista": [
        "Limpeza dos drenos e das juntas do tabuleiro a cada 6 meses",
        "Verificação dos aparelhos de apoio de neoprene a cada 12 meses",
        "Vistoria dos pilares e blocos sempre que o HID-01 passar do limite de atenção",
    ],
    "inspecoes": [
        {"atividade": "Inspeção cadastral (entrada em operação)",
         "data_executada": "2027-01-12", "condicao": "Boa", "nao_conformidade": None,
         "servico_realizado": "nenhum (registro do estado inicial)", "decisao": "conservar",
         "status": "executada", "custo_rs": None, "observacao": None},
        {"atividade": "Inspeção extraordinária, depois da cheia",
         "data_executada": (fim_cheia + timedelta(days=3)).isoformat(), "condicao": "Regular",
         "nao_conformidade": "galhada presa nos pilares do vão central; sem erosão nos blocos",
         "servico_realizado": "remoção da galhada com caminhão munck",
         "decisao": "conservar", "status": "executada", "custo_rs": 2400.00,
         "observacao": f"o HID-01 ficou em atenção de {inicio_cheia:%d/%m} a {fim_cheia:%d/%m}"},
        {"atividade": "Inspeção rotineira",
         "data_executada": "2027-07-14", "condicao": "Boa",
         "nao_conformidade": "terra acumulada na junta de dilatação do encontro leste",
         "servico_realizado": "limpeza das juntas e dos drenos do tabuleiro",
         "decisao": "conservar", "status": "executada", "custo_rs": 950.00, "observacao": None},
    ],
    "proxima": {"atividade": "Inspeção rotineira, antes das chuvas",
                "data_planejada": "2027-11-16", "responsavel": "Equipe de conservação 01",
                "status": "planejada"},
}

# ------------------------------------------------------------------ os sensores da estrutura
# Três sensores propostos nos esboços de 02/11/2026 e aprovados pelo dono junto com a Sala de
# operação ("tem que apresentar os outros sensores também além da ponte, para mostrar o que
# estamos medindo"). Todos inventados, no molde do HID-01: a mesma semana, a mesma chuva, o
# mesmo rio. A posição sai do ponte.json: o centro do vão central, o azimute do eixo (119,7°,
# então andar no eixo para +u vai para o leste-sudeste) e os vãos de 34,80 m, com os pilares do
# vão central a ±17,4 m do centro.
centro_e, centro_n = ponte["meio_vao_central_utm"]
az = math.radians(ponte["azimute_graus"])


def no_eixo(u):
    """Ponto a u metros do centro do vão central, ao longo do eixo da ponte (UTM)."""
    return (centro_e + u * math.sin(az), centro_n + u * math.cos(az))


# Temperatura média do tabuleiro na semana, para o regime da Zona da Mata: ~26 °C em janeiro e
# ~17 °C em julho. A junta e a frequência do vão mudam com ela, e é isso que as duas curvas
# mostram; sem a temperatura do lado, a curva da junta pareceria um defeito.
temperaturas = [round(21.5 + 4.5 * math.cos(2 * math.pi * (i - 3) / 52) + 0.6 * math.sin(1.3 * i), 1)
                for i in range(len(leituras))]

# EROS-01: a cheia escava o leito junto ao pilar e o rio devolve o material devagar depois.
# A escavação segue a altura livre (0,35 m por metro abaixo de 6,2 m livres), e o reaterro tira
# 5% do que sobrou por semana. Com a menor altura livre da série (4,02 m em 08/02) dá 0,91 m, perto
# do limite de atenção de 1,0 m sem passar; em 20/09 sobra ~0,3 m.
EROS_BASE, EROS_POR_M, EROS_LIVRE_REF, EROS_REATERRO = 0.15, 0.35, 6.2, 0.95
EROS_ATENCAO, EROS_ALERTA = 1.0, 2.0
leituras_eros, erosao = [], EROS_BASE
for l in leituras_rio:
    alvo = EROS_BASE + EROS_POR_M * max(0.0, EROS_LIVRE_REF - l["altura_livre_m"])
    erosao = max(alvo, EROS_BASE + (erosao - EROS_BASE) * EROS_REATERRO)
    leituras_eros.append({"data": l["data"], "valor": round(erosao, 2)})
if max(l["valor"] for l in leituras_eros) >= EROS_ATENCAO:
    sys.exit("ERRO: a erosão no pilar (EROS-01) passou do limite de atenção; a história combinada é "
             "chegar perto na cheia sem passar. Confira as constantes EROS_ acima.")
# O sonar fica preso no pilar meio metro acima da maior cheia da série, para não ser arrastado.
cota_sonar = round(max(l["nivel_m"] for l in leituras_rio) + 0.5, 2)

# JUN-01: a junta do encontro leste fecha quando o tabuleiro esquenta. 0,53 mm por °C é a
# dilatação do concreto (1,0e-5 por °C) em meio tabuleiro, 52,5 m até o ponto fixo no meio.
JUN_REF_MM, JUN_REF_C, JUN_POR_C = 20.0, 20.0, 0.53
JUN_ATENCAO, JUN_ALERTA = 10.0, 5.0
leituras_jun = [{"data": l["data"], "valor": round(JUN_REF_MM - JUN_POR_C * (t - JUN_REF_C) + 0.1 * math.sin(2.7 * i), 1),
                 "temperatura_c": t}
                for i, (l, t) in enumerate(zip(leituras, temperaturas))]

# ACL-01: a frequência própria do vão central. 3,12 Hz para uma viga de 34,8 m bate com a regra de
# bolso de pontes de concreto (~100/L, 2,9 Hz). O concreto quente fica um pouco menos rígido: 0,12%
# a menos por °C. Uma queda de 5% sem a temperatura explicar é sinal de fissura ou perda de
# protensão (atenção); de 10%, alerta.
ACL_REF_HZ, ACL_POR_C = 3.12, 0.0012
ACL_ATENCAO, ACL_ALERTA = round(ACL_REF_HZ * 0.95, 2), round(ACL_REF_HZ * 0.90, 2)
leituras_acl = [{"data": l["data"], "valor": round(ACL_REF_HZ * (1 - ACL_POR_C * (t - 20)) + 0.004 * math.sin(2.1 * i), 3),
                 "temperatura_c": t}
                for i, (l, t) in enumerate(zip(leituras, temperaturas))]


def sensor_da_ponte(id_, u, cota, **campos):
    e, n = no_eixo(u)
    return {"id": id_, "onde": "ponte", **campos, "ultima_transmissao": "2027-09-20T06:00",
            "utm": [round(e, 3), round(n, 3)], "xz": local(e, n), "cota_m": cota}


TEMPERATURA = {"chave": "temperatura_c", "rotulo": "Temperatura do tabuleiro", "unidade": "°C"}
sensores_ponte = [
    sensor_da_ponte(
        "EROS-01", 17.4, cota_sonar, nome="Erosão no pilar",
        tipo="Sonar de erosão preso no pilar leste do vão central",
        mede="a profundidade da erosão do leito junto ao pilar, em relação ao leito de projeto",
        unidade="m", casas=2, sentido="acima", limite_atencao=EROS_ATENCAO, limite_alerta=EROS_ALERTA,
        bateria_pct=84, leituras=leituras_eros),
    sensor_da_ponte(
        "JUN-01", ponte["comprimento_tabuleiro_m"] / 2, ponte["cota_tabuleiro_m"], nome="Junta do encontro leste",
        tipo="Medidor de abertura na junta de dilatação do encontro leste, com termômetro no tabuleiro",
        mede="a abertura da junta, que fecha quando o tabuleiro esquenta",
        unidade="mm", casas=1, sentido="abaixo", limite_atencao=JUN_ATENCAO, limite_alerta=JUN_ALERTA,
        secundaria=TEMPERATURA, bateria_pct=93, leituras=leituras_jun),
    sensor_da_ponte(
        "ACL-01", -ponte["vaos_m"][1] / 4, ponte["cota_fundo_vigas_m"], nome="Vibração do vão central",
        tipo="Acelerômetro sob a viga, a um quarto do vão central",
        mede=f"a frequência própria do vão central; a de referência, {ACL_REF_HZ:.2f} Hz, é a da entrada em operação",
        unidade="Hz", casas=2, sentido="abaixo", limite_atencao=ACL_ATENCAO, limite_alerta=ACL_ALERTA,
        secundaria=TEMPERATURA, bateria_pct=77, leituras=leituras_acl),
]

# A foto da patologia é ilustrativa (escolha do dono em 02/11/2026: "banco livre, com crédito"):
# não é o BUEIRO_001 e nem é boca de bueiro, é uma fissura num muro de contenção. No Commons não
# havia ala de bueiro com fissura à vista; a que mais se parecia (HAER CA-2259-C-4, domínio
# público) mostra a ala sem fissura nenhuma.
patologia["foto_ilustrativa"] = {
    "arquivo": "dados/fotos/fissura_ilustrativa.jpg",
    "legenda": "Foto ilustrativa: fissura vertical num muro de contenção de concreto. Não é o BUEIRO_001.",
    "autor": "Sunolafjagtenben-hur", "licenca": "CC0", "fonte": "Wikimedia Commons",
    "endereco": "https://commons.wikimedia.org/wiki/File:Detail_of_vertical_crack_in_concrete_retaining_wall"
                "_at_Medway_Park_Sports_Centre,_Gillingham,_Kent,_England.jpg",
}
# A inspeção de 15/09 é a que achou a fissura: a ficha mostra a mesma foto no lugar do quadro cinza.
# O foto_1 continua com o nome do registro de campo, que é o do padrão do AIM.
inspecoes[2]["foto_ilustrativa"] = patologia["foto_ilustrativa"]["arquivo"]

with open(os.path.join(pasta, "gemeo_ficticio.json"), "w", encoding="utf-8") as arq:
    json.dump({"aviso": "Dados FICTÍCIOS, só para demonstrar o modelo digital do BRG4.",
               "data_simulada": DATA_SIMULADA.isoformat(), "inspecoes": inspecoes,
               "proximas_inspecoes": proximas,
               "patologia": patologia, "sensor": sensor,
               "sensor_rio": sensor_rio, "sensores_ponte": sensores_ponte, "ponte": ponte_ficticia,
               "pontos_extras": {"boca_entrada": {"utm": list(BOCA_ENTRADA),
                                                  "xz": local(*BOCA_ENTRADA)}}},
              arq, ensure_ascii=False, indent=1)

print(f"{len(ativos)} ativos, {len(guid_para_ativo)} componentes ligados ao IFC, "
      f"{len(fora_do_aim)} elementos do IFC sem ficha")
if sem_ativo:
    print(f"ATENÇÃO: {len(sem_ativo)} componentes apontam para ativo que não existe: {sem_ativo}")
print(f"sensor: {len(leituras)} leituras, último deslocamento {acumulado:.1f} mm")
print(f"próximas inspeções planejadas: {len(proximas)} de {len(ativos)} ativos")
print(f"rio (HID-01): {len(leituras_rio)} leituras, atenção de {inicio_cheia:%d/%m} a "
      f"{fim_cheia:%d/%m}, altura livre em {leituras_rio[-1]['data']}: "
      f"{leituras_rio[-1]['altura_livre_m']} m")
for s in sensores_ponte:
    v = [l["valor"] for l in s["leituras"]]
    print(f"{s['id']}: de {min(v)} a {max(v)} {s['unidade']}, hoje {v[-1]} {s['unidade']} "
          f"(atenção {s['limite_atencao']}, alerta {s['limite_alerta']}, {s['sentido']}); cota {s['cota_m']}")
