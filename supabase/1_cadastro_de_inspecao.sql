-- Cadastro de inspeção pelo link do modelo digital do BRG4.
--
-- Como usar: no Supabase, SQL Editor → New query, colar este arquivo inteiro e apertar Run.
-- Pode rodar de novo sem medo: nada aqui apaga linha nem foto; o que já existe fica como está.
--
-- A página não tem login, então qualquer um com o link grava. Quem protege é o próprio banco:
-- as listas fechadas e as regras do formulário do QField (3_projeto_qgis.py) viram restrição
-- aqui, e o link só grava e lê. Apagar, só o dono, pelo painel do Supabase.

-- ---------------------------------------------------------------------------------------------
-- 1. Os ativos que existem: os 55 do AIM (dados/ativos.json, MD5 18934399…) e a ponte, OAE-01,
--    que não está no AIM mas tem operação fictícia. Sem esta lista, um toque errado gravaria
--    inspeção de um ativo que não existe, e ela nunca apareceria em ficha nenhuma.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.ativos_brg4 (
  id_ativo text primary key
);

insert into public.ativos_brg4 (id_ativo) values
  ('ATERRO_001'), ('BASE_003'), ('BASE_004'), ('BASE_005'), ('BASE_006'), ('BASE_009'),
  ('BASE_010'), ('BASE_011'), ('BASE_012'), ('BUEIRO_001'), ('Boca_Bueiro_004'),
  ('Boca_Bueiro_005'), ('CORTE_001'), ('Dissipador_002'), ('REVESTIMENTO_003'),
  ('REVESTIMENTO_004'), ('REVESTIMENTO_005'), ('REVESTIMENTO_006'), ('REVESTIMENTO_009'),
  ('REVESTIMENTO_010'), ('REVESTIMENTO_011'), ('REVESTIMENTO_012'), ('REVESTIMENTO_2_003'),
  ('REVESTIMENTO_2_004'), ('REVESTIMENTO_2_005'), ('REVESTIMENTO_2_006'), ('REVESTIMENTO_2_009'),
  ('REVESTIMENTO_2_010'), ('REVESTIMENTO_2_011'), ('REVESTIMENTO_2_012'), ('SUB_BASE_001'),
  ('SUB_BASE_001_002'), ('SUB_BASE_001_003'), ('SUB_BASE_001_004'), ('SUB_BASE_001_005'),
  ('SUB_BASE_001_006'), ('SUB_BASE_001_007'), ('SUB_BASE_001_008'), ('SUB_BASE_001_009'),
  ('SUB_BASE_001_010'), ('SUB_BASE_001_011'), ('SUB_BASE_001_012'), ('SUB_BASE_001_013'),
  ('SUB_BASE_001_014'), ('SUB_BASE_001_015'), ('SUB_BASE_001_016'), ('SUB_BASE_003'),
  ('SUB_BASE_004'), ('SUB_BASE_005'), ('SUB_BASE_006'), ('SUB_BASE_009'), ('SUB_BASE_010'),
  ('SUB_BASE_011'), ('SUB_BASE_012'), ('SUPERFÍCIE CORREDOR DE TERRAPLENAGEM'),
  ('OAE-01')
on conflict (id_ativo) do nothing;

alter table public.ativos_brg4 enable row level security;
revoke all on public.ativos_brg4 from anon, authenticated;
grant select on public.ativos_brg4 to anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ativos_brg4' and policyname = 'link lê') then
    create policy "link lê" on public.ativos_brg4 for select to anon, authenticated using (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. As inspeções. Os 16 campos são os da tabela inspecoes do BRG4_AIM.gpkg, com os mesmos
--    nomes, para um cadastro do link poder ir para o GeoPackage sem tradução. Depois deles, o
--    que o QField não precisa porque o ponto já vem do ativo: onde se tocou e de que vista.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.inspecoes_link (
  id                      bigint generated always as identity primary key,
  -- aba Visita
  id_ativo                text not null references public.ativos_brg4 (id_ativo),
  atividade               text,
  status                  text not null default 'executada',
  data_planejada          date,
  data_executada          date default current_date,
  responsavel             text,
  -- aba Achado
  condicao                text,
  nao_conformidade        text,
  servico_realizado       text,
  materiais_equipamentos  text,
  decisao                 text,
  proxima_data            date,
  custo_rs                numeric(12, 2),
  observacao              text,
  -- aba Fotos: o caminho dentro do balde fotos-inspecao
  foto_1                  text,
  foto_2                  text,
  -- onde e de onde
  latitude                double precision not null,
  longitude               double precision not null,
  cota_m                  double precision,
  origem                  text not null,
  criado_em               timestamptz not null default now(),

  -- As listas fechadas do QField. No celular, "Regular", "regular" e "reg." viram três
  -- condições diferentes na hora de contar.
  constraint status_da_lista   check (status in ('planejada', 'executada', 'não executada')),
  constraint condicao_da_lista check (condicao is null or condicao in ('Boa', 'Regular', 'Ruim', 'Crítica')),
  constraint decisao_da_lista  check (decisao is null or decisao in ('conservar', 'reparar', 'reprogramar')),
  constraint origem_da_lista   check (origem in ('mapa', '3d')),

  -- As regras do QField: visita planejada ainda não tem condição nem decisão, mas executada sem
  -- elas não serve para nada; reprogramar é marcar a data nova.
  constraint executada_precisa_de_condicao check (status <> 'executada' or condicao is not null),
  constraint executada_precisa_de_decisao  check (status <> 'executada' or decisao is not null),
  constraint reprogramar_precisa_de_data   check (decisao is distinct from 'reprogramar' or proxima_data is not null),

  -- Contra lixo de quem achar o link. A caixa dos ativos vai de -43,1047 a -43,0977 de
  -- longitude e de -20,7226 a -20,7209 de latitude (geojson de 02/11/2026); a folga é de ~2 km.
  constraint perto_do_brg4 check (latitude between -20.74 and -20.70 and longitude between -43.12 and -43.08),
  constraint cota_plausivel check (cota_m is null or cota_m between 400 and 800),
  constraint custo_plausivel check (custo_rs is null or custo_rs between 0 and 10000000),
  constraint datas_plausiveis check (
    coalesce(data_planejada, '2027-01-01') between '2020-01-01' and '2040-12-31'
    and coalesce(data_executada, '2027-01-01') between '2020-01-01' and '2040-12-31'
    and coalesce(proxima_data, '2027-01-01') between '2020-01-01' and '2040-12-31'),
  constraint textos_curtos check (
    coalesce(char_length(atividade), 0) <= 200
    and coalesce(char_length(responsavel), 0) <= 120
    and coalesce(char_length(nao_conformidade), 0) <= 1000
    and coalesce(char_length(servico_realizado), 0) <= 1000
    and coalesce(char_length(materiais_equipamentos), 0) <= 1000
    and coalesce(char_length(observacao), 0) <= 1000),
  constraint foto_no_balde check (
    (foto_1 is null or foto_1 ~ '^inspecoes/[A-Za-z0-9_.-]+\.jpg$')
    and (foto_2 is null or foto_2 ~ '^inspecoes/[A-Za-z0-9_.-]+\.jpg$'))
);

-- O link grava e lê. Não altera nem apaga: sem política de update e de delete, o banco recusa,
-- e as permissões abaixo recusam de novo. id e criado_em ficam fora da lista de colunas que o
-- link pode escrever, para ninguém inventar a data de um cadastro.
alter table public.inspecoes_link enable row level security;
revoke all on public.inspecoes_link from anon, authenticated;
grant select on public.inspecoes_link to anon, authenticated;
grant insert (id_ativo, atividade, status, data_planejada, data_executada, responsavel,
              condicao, nao_conformidade, servico_realizado, materiais_equipamentos, decisao,
              proxima_data, custo_rs, observacao, foto_1, foto_2,
              latitude, longitude, cota_m, origem)
  on public.inspecoes_link to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inspecoes_link' and policyname = 'link lê') then
    create policy "link lê" on public.inspecoes_link for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inspecoes_link' and policyname = 'link grava') then
    create policy "link grava" on public.inspecoes_link for insert to anon, authenticated with check (true);
  end if;
end $$;

-- Um teto, para um robô que ache o link não encher o plano gratuito. 300 é dez vezes o que
-- uma banca cadastraria; quando chegar, o dono limpa pelo painel e o link volta a gravar.
create or replace function public.teto_do_cadastro() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.inspecoes_link) >= 300 then
    raise exception 'O cadastro pelo link chegou a 300 inspeções, o teto da demonstração. Peça ao dono do projeto para limpar as antigas no painel do Supabase.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace trigger teto_do_cadastro
  before insert on public.inspecoes_link
  for each row execute function public.teto_do_cadastro();

-- ---------------------------------------------------------------------------------------------
-- 3. O balde das fotos. Público para ler (a ficha mostra a foto pelo endereço dela), só JPEG,
--    até 1 MB. A página reduz a foto no celular antes de enviar: o lado maior a 1.600 px em
--    JPEG dá algumas centenas de kB, contra 3 a 5 MB da câmera de um celular.
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-inspecao', 'fotos-inspecao', true, 1048576, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Envia só para a pasta inspecoes/ e só .jpg; sem política de update e de delete, a foto
-- enviada não é trocada nem apagada pelo link. A de leitura existe porque o envio do Supabase
-- lê de volta o que acabou de gravar.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'fotos-inspecao: link envia') then
    create policy "fotos-inspecao: link envia" on storage.objects for insert to anon, authenticated
      with check (bucket_id = 'fotos-inspecao'
                  and (storage.foldername(name))[1] = 'inspecoes'
                  and storage.extension(name) = 'jpg');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'fotos-inspecao: link lê') then
    create policy "fotos-inspecao: link lê" on storage.objects for select to anon, authenticated
      using (bucket_id = 'fotos-inspecao');
  end if;
end $$;

-- Conferência: deve sair 56 ativos, 0 inspeções e o balde com 1048576 e image/jpeg.
select (select count(*) from public.ativos_brg4)     as ativos,
       (select count(*) from public.inspecoes_link)  as inspecoes,
       (select file_size_limit from storage.buckets where id = 'fotos-inspecao') as limite_foto,
       (select allowed_mime_types from storage.buckets where id = 'fotos-inspecao') as tipos_foto;
