<!-- dg-dev: atualizado=2026-11-03 -->

# Modelo digital do BRG4 — página de demonstração

Uma página que a banca do TFM abre pelo celular (link ou QR code) para ver como
funcionaria o modelo digital da rodovia BRG4: mapa com foto aérea, o modelo 3D do
IFC, a ficha de cada ativo, o histórico de inspeção e um sensor.

**Por que "modelo digital" e não "gêmeo digital".** Mudado em 03/11/2026, a pedido do dono:
um gêmeo é a cópia de uma obra que existe e manda dados de verdade, e o BRG4 é uma obra fictícia.
Os nomes internos (`gemeo_ficticio.json`, a pasta local) ficaram como estavam, porque a banca não
os vê e trocá-los mexeria em 20 lugares do código (contados em 03/11/2026) sem mudar nada na página.

**Endereço público:** <https://lfmoura72-ux.github.io/modelo-digital-brg4/> (GitHub Pages do
repositório público `lfmoura72-ux/modelo-digital-brg4`, no ar desde 02/11/2026, com a aprovação do
grupo e da Zigurat para os dados do BRG4 ficarem públicos). O botão "Compartilhar" mostra o QR code.
Até 03/11/2026 o endereço era `.../gemeo-digital-brg4/`, que deixou de abrir com a troca de nome.

**O que é real e o que é fictício.** Real: a geometria (os IFC do grupo), os 55
ativos, os IDs, a classificação Uniclass e as tarefas de manutenção (COBie e
`BRG4_AIM.gpkg`). Fictício: as três inspeções do `BUEIRO_001`, a patologia
`PAT-2027-003`, o sensor `INC-01` no talude de corte, a data da próxima inspeção
planejada de cada um dos 55 ativos (o intervalo é o real do COBie, contado a partir
da situação simulada de 20/09/2027), o medidor do rio `HID-01` sob a ponte, os três sensores da estrutura da ponte
(`EROS-01`, erosão no pé do pilar; `JUN-01`, abertura da junta do encontro leste; `ACL-01`,
frequência própria do vão central) e a operação da ponte (`OAE-01`: condição, inspeções e
manutenção prevista). A foto da patologia é ilustrativa: é de um muro de contenção, não do
`BUEIRO_001`, e a página diz isso na legenda. A página põe
o selo "FICTÍCIO" em tudo que vem de `dados/gemeo_ficticio.json`.

Da ponte, é real o que está em `dados/ponte.json`, medido no IFC dela: comprimento,
largura, vãos, estaca, cotas, peças por tipo e material. O medidor do rio usa duas
cotas reais (fundo das vigas 579,11 e fundo do vale 571,01); a água, a vazão e os
limites são inventados, porque a ponte não tem estudo hidrológico.

Do rio, é real o que está em `dados/rio_piranga_ana.json`: a série de vazão da ANA na
estação 56075000 Porto Firme, a ~6 km rio abaixo da ponte. A ficha da ponte mostra esses
números com o selo "dado real · ANA", ao lado do medidor fictício, para a banca ver que a
vazão inventada está na escala do rio de verdade.

O traçado do rio no 3D também é real: a linha de centro do Piranga no OpenStreetMap
(`dados/rio_piranga_osm.json`), que passa a 13,7 m do meio do vão central. O
OpenStreetMap não tem as margens, então a largura (50 m) é posta pela página; a cota da
água é a do HID-01, fictício, com a declividade de 0,1% da curva-chave.

**O que ela grava: as inspeções cadastradas pelo link.** No mapa ou na aba 3D, o botão
"Nova inspeção" arma o próximo toque; tocar no ponto do achado abre a ficha do QField (abas
Visita, Achado e Fotos, os mesmos 16 campos e as mesmas regras) com o ativo sob o toque, ou o
mais perto. A inspeção vai para um banco no Supabase (projeto `lkflwnuhexpkpehvwuui`, conta do
dono) e aparece **para todo mundo que abrir o link**: na ficha do ativo, num bloco próprio com o
selo azul "cadastrado pelo link", como pino azul no mapa e no 3D (grupo "Cadastrado pelo link" na
legenda) e, se a condição for Ruim ou Crítica, em "Pede atenção" no Painel. A foto, da câmera ou
da galeria, é reduzida no próprio celular a 1.600 px em JPEG (sem os dados de GPS da câmera)
antes de ir para o balde `fotos-inspecao`.

Conferido em 02/11/2026 com um envio de verdade, tocado na ponte pelo 3D: uma foto de 3000 × 2000
px (566 kB) subiu com 118 kB, e a inspeção apareceu na ficha, no mapa, no 3D, na legenda e em
"Pede atenção", em 1280 e em 375 px.

O banco é montado pelo `supabase/1_cadastro_de_inspecao.sql` (colar no SQL Editor do Supabase e
apertar Run; pode rodar de novo sem apagar nada). Quem protege é o próprio banco: o link só
lê e grava direto na tabela, e nunca altera nem apaga por conta própria (editar e apagar passam
pelas funções descritas abaixo); as listas fechadas e as regras do QField são conferidas lá; a
foto só entra como JPEG até 1 MB; e o cadastro para em 300 inspeções. A chave que está no
`js/cadastro.js` é a pública (`sb_publishable_…`), feita para ficar na página; a secreta nunca
entra aqui.

**Apagar e editar pelo link, sem login.** Dois arquivos a mais em `supabase/`, para rodar nesta
ordem no SQL Editor: primeiro o `2_apagar_e_editar.sql` (cola inteiro e Run; também pode rodar de
novo sem apagar nada), depois, uma vez só, o `3_palavra_do_dono.sql`. Quem pode mexer numa
inspeção: (a) **quem gravou, do mesmo celular**: a página sorteia um segredo na gravação, guarda no
aparelho e manda ao banco só o hash dele, numa coluna que o link não consegue ler; (b) **o dono**,
com a palavra-código ("Sou o dono", um botão discreto no fim do bloco "Cadastradas pelo link",
que é o primeiro da ficha). A palavra-código **nunca
vai para arquivo nenhum**: o `3_palavra_do_dono.sql` traz um marcador, a palavra é digitada só no
SQL Editor na hora de rodar (o banco guarda apenas o hash) e, no aparelho do dono, fica no
`localStorage` depois que o banco a confirma. A foto é apagada pela página, pela API do Storage,
logo depois de o banco apagar ou editar a linha; se o Storage não apagar, a página avisa o nome
da foto e o dono apaga no painel do Supabase (Storage → `fotos-inspecao`).

**Atenção na véspera da banca:** o projeto gratuito do Supabase adormece depois de 7 dias sem uso.
Abra a página (ou o painel do Supabase) no dia anterior. Se o banco estiver dormindo, a página
funciona igual e avisa no pé que não conseguiu ler as inspeções do link.

**O que ela não faz:** não tem login, não lê o GeoPackage ao vivo, e o que é cadastrado pelo link
não volta sozinho para o `BRG4_AIM.gpkg` (os nomes das colunas são os mesmos, para a cópia ser
direta). O resto é uma fotografia dos dados de 02/11/2026.

## Como refazer os dados

Os originais nunca são tocados: o GeoPackage é aberto só para leitura (MD5
`b4fd37f2…` igual antes e depois, em 02/11/2026).

1. **O 3D** (Python do Blender, ifcopenshell do Bonsai):

   ```bash
   "C:/Program Files/Blender Foundation/Blender 5.1/5.1/python/bin/python.exe" -I ferramentas/1_ifc_para_glb.py \
     "<GIS_BRG4>/fontes/COBie-BRG4-MODELO-FEDERADO.ifc" \
     "<entrega B5>/01_Modelo/Federado/Ponte Rodoviaria Parametrizada V3.ifc" \
     dados/modelo.glb dados/elementos_ifc.json
   ```

   Se ele disser que não acha o ifcopenshell: desempacote
   `%APPDATA%/Blender Foundation/Blender/5.1/extensions/blender_org/bonsai/wheels/ifcopenshell-*.whl`
   numa pasta e rode com `IFCOPENSHELL_DIR` apontando para ela. O passo 1b também
   precisa do `shapely-*.whl` e do `lark-*.whl` da mesma pasta, desempacotados junto.

   `<entrega B5>` é `<GIS_BRG4>/MBCIVPT_TFM B5_Entrega Final_Grupo 4_Nome aluno/MBCIVPT_TFM B5_Entrega Final_Grupo 4_LuizFerreira`
   (MD5 da ponte `3809898e…`, o mesmo das cópias do módulo 10 T02 e do TFM B4).

1b. **Os números da ponte** (mesmo Python; lê o `dados/ativos.json` para achar a estaca,
   então numa pasta nova rode o passo 3 uma vez antes):

   ```bash
   "C:/Program Files/Blender Foundation/Blender 5.1/5.1/python/bin/python.exe" -I ferramentas/1b_dados_da_ponte.py \
     "<GIS_BRG4>/fontes/COBie-BRG4-MODELO-FEDERADO.ifc" \
     "<entrega B5>/01_Modelo/Federado/Ponte Rodoviaria Parametrizada V3.ifc" dados
   ```

2. **O mapa** (ogr2ogr do QGIS 3.40.11, com `PROJ_DATA` e `GDAL_DATA` apontando para
   `share/proj` e `share/gdal` dele):

   ```bash
   ogr2ogr -f GeoJSON -t_srs EPSG:4326 -lco COORDINATE_PRECISION=7 -lco RFC7946=YES -oo IMMUTABLE=YES dados/ativos_area.geojson  "<GIS_BRG4>/BRG4_AIM.gpkg" ativos_area
   ogr2ogr -f GeoJSON -t_srs EPSG:4326 -lco COORDINATE_PRECISION=7 -lco RFC7946=YES -oo IMMUTABLE=YES dados/ativos_ponto.geojson "<GIS_BRG4>/BRG4_AIM.gpkg" ativos_ponto
   ogr2ogr -f CSV -oo IMMUTABLE=YES dados/componentes.csv "<GIS_BRG4>/BRG4_AIM.gpkg" componentes
   ```

3. **A junção e o fictício:** `py -3 -I ferramentas/2_montar_dados.py dados` (precisa
   do `dados/ponte.json` do passo 1b, de onde saem as cotas do medidor do rio)

4. **O rio Piranga de verdade** (vazão diária da ANA, estação 56075000 Porto Firme; vai à
   internet e grava `dados/rio_piranga_ana.json`):

   ```bash
   py -3 -I ferramentas/3_vazao_ana.py dados
   ```

   O XML baixado (3,3 MB) não é guardado. Para reprocessar um XML que já está no disco,
   sem ir à internet: `--xml <arquivo.xml>`. Só entram na cheia anual e no Gumbel os anos
   com os 12 meses (1988 fica de fora: dezembro sem leitura).

5. **O traçado do rio** (linha de centro do Piranga no OpenStreetMap, pelo Overpass; vai à
   internet, precisa do `dados/ativos.json` e do `dados/ponte.json`, e grava
   `dados/rio_piranga_osm.json`):

   ```bash
   py -3 -I ferramentas/4_rio_osm.py dados
   ```

   Para reprocessar uma resposta do Overpass já salva: `--json <arquivo.json>`. O script
   para se a linha passar a mais de 35 m do meio do vão central. O Overpass às vezes
   responde 502 ou 504 quando está cheio: é só tentar de novo depois.

`<GIS_BRG4>` é `OneDrive/POS/ZIGUTAS/MODULO 13/GIS_BRG4`.

## Como ver no computador

A página precisa de um servidor (o navegador recusa ler `dados/` pelo arquivo direto):

```bash
py -3 -m http.server 8765
```

e abrir `http://localhost:8765`.

## Como publicar uma mudança

Salvar a versão (`git commit`) e enviar (`git push`): o GitHub refaz o site sozinho em cerca de
um minuto. O ramo `main` é o público e começa numa versão única de 02/11/2026, assinada com o
endereço mascarado do GitHub (`…@users.noreply.github.com`, já configurado só nesta pasta), para o
e-mail pessoal do dono não aparecer. As 20 versões do desenvolvimento ficam no ramo
`historico-privado`, **só neste computador: nunca enviar esse ramo**, porque ele traz o e-mail.

O site entrega os arquivos de texto com o fim de linha do Git (LF), e esta pasta, no Windows, tem o
fim de linha do Windows (CRLF). Por isso o `dados/ativos.json` publicado tem outro MD5 (`b2abcd57…`)
que o do disco (`18934399…`): tirando o fim de linha, são o mesmo arquivo (conferido em 02/11/2026).

## Créditos

- Foto aérea: Esri World Imagery (Esri, Maxar, Earthstar Geographics), carregada ao
  vivo, não guardada.
- Ponte: modelo paramétrico de terceiros (Revit), o mesmo da entrega do grupo; o
  crédito está no BEP.
- Foto ilustrativa da fissura (`dados/fotos/fissura_ilustrativa.jpg`): Sunolafjagtenben-hur,
  CC0, Wikimedia Commons ("Detail of vertical crack in concrete retaining wall at Medway Park
  Sports Centre, Gillingham, Kent, England"), reduzida para 720 × 960 px.
- Vazão do rio Piranga: Agência Nacional de Águas e Saneamento Básico (ANA), Hidroweb,
  série histórica da estação 56075000 Porto Firme.
- Traçado do rio Piranga: © colaboradores do OpenStreetMap, licença ODbL (way 176297690);
  o crédito aparece no canto do 3D.
