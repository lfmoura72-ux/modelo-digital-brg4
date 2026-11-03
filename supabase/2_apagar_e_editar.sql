-- Apagar e editar pelo link do gêmeo digital do BRG4, sem login.
--
-- Como usar: no Supabase, SQL Editor → New query, colar este arquivo inteiro e apertar Run. Depois,
-- uma vez só, o 3_palavra_do_dono.sql, com a palavra-código digitada no próprio SQL Editor.
-- Pode rodar de novo sem medo: nada aqui apaga linha nem foto.
--
-- Quem pode mexer numa inspeção (escolhido pelo dono em 02/11/2026):
--   * quem gravou, do mesmo aparelho: a página sorteia um segredo na gravação, guarda no aparelho e
--     manda ao banco só o hash dele (SHA-256), numa coluna que o link não lê;
--   * o dono, com uma palavra-código, guardada aqui só como hash bcrypt.
-- O link continua sem update e delete diretos na tabela: tudo passa por apagar_inspecao e
-- editar_inspecao, que conferem um dos dois antes de mexer.
--
-- A foto: medido em 02/11/2026 (Storage 1.84.25), apagar a linha de storage.objects por SQL não apaga
-- o arquivo, só o registro, e o Storage recusa esse apagar direto. Quem apaga o arquivo é a página,
-- pela API do Storage; a regra do balde abaixo só deixa apagar a foto que uma das duas funções
-- liberou. Antes desta regra, o mesmo pedido com a chave pública respondeu "200, []" e a foto ficou.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------------------------
-- 1. Colunas novas na inspeção: o hash do segredo e a hora da última edição.
-- ---------------------------------------------------------------------------------------------
alter table public.inspecoes_link add column if not exists segredo_hash text;
alter table public.inspecoes_link add column if not exists editado_em timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'segredo_em_hash' and conrelid = 'public.inspecoes_link'::regclass) then
    alter table public.inspecoes_link add constraint segredo_em_hash
      check (segredo_hash is null or segredo_hash ~ '^[0-9a-f]{64}$');
  end if;
end $$;

-- O link lia a tabela inteira; agora lê tudo menos o hash. Com permissão por coluna, a página tem de
-- pedir as colunas pelo nome: "select=*" passa a ser recusado.
revoke select on public.inspecoes_link from anon, authenticated;
grant select (id, id_ativo, atividade, status, data_planejada, data_executada, responsavel,
              condicao, nao_conformidade, servico_realizado, materiais_equipamentos, decisao,
              proxima_data, custo_rs, observacao, foto_1, foto_2,
              latitude, longitude, cota_m, origem, criado_em, editado_em)
  on public.inspecoes_link to anon, authenticated;
grant insert (segredo_hash) on public.inspecoes_link to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. O que o link não enxerga: a palavra do dono, as tentativas erradas e as fotos liberadas.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.dono_brg4 (
  id           smallint primary key default 1 check (id = 1),
  palavra_hash text not null,
  definida_em  timestamptz not null default now()
);
create table if not exists public.tentativas_do_dono (
  quando timestamptz not null default now()
);
create table if not exists public.fotos_a_apagar (
  caminho     text primary key,
  liberada_em timestamptz not null default now()
);
alter table public.dono_brg4 enable row level security;
alter table public.tentativas_do_dono enable row level security;
alter table public.fotos_a_apagar enable row level security;
revoke all on public.dono_brg4, public.tentativas_do_dono, public.fotos_a_apagar from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. As conferências. Recusa volta como resposta ({ok: false}), não como erro: um erro desfaria a
--    anotação da tentativa errada, e o limite de tentativas não contaria nada.
-- ---------------------------------------------------------------------------------------------

-- Dez erros em dez minutos fecham a porta do dono por dez minutos. Contra robô chutando a palavra
-- pelo link; o outro lado é que quem chutar dez vezes tranca também o dono, pelo mesmo tempo.
create or replace function public.conferir_palavra_do_dono(p_palavra text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  h text;
begin
  if p_palavra is null or p_palavra = '' then return 'recusado'; end if;
  select palavra_hash into h from public.dono_brg4 where id = 1;
  if h is null then return 'sem_palavra'; end if;
  delete from public.tentativas_do_dono where quando < now() - interval '10 minutes';
  if (select count(*) from public.tentativas_do_dono) >= 10 then return 'bloqueado'; end if;
  if extensions.crypt(p_palavra, h) = h then return 'ok'; end if;
  insert into public.tentativas_do_dono default values;
  return 'recusado';
end $$;

-- 'segredo' ou 'dono' autorizam; 'nao_existe', 'recusado', 'bloqueado' e 'sem_palavra' não.
-- O "for update" segura a linha até o fim da função: dois apagar ao mesmo tempo não se atropelam.
create or replace function public.quem_mexe(p_id bigint, p_segredo text, p_palavra text) returns text
language plpgsql security definer set search_path = public as $$
declare
  h text;
  r text;
begin
  select segredo_hash into h from public.inspecoes_link where id = p_id for update;
  if not found then return 'nao_existe'; end if;
  if p_segredo is not null and h is not null
     and encode(sha256(convert_to(p_segredo, 'UTF8')), 'hex') = h then
    return 'segredo';
  end if;
  r := public.conferir_palavra_do_dono(p_palavra);
  return case when r = 'ok' then 'dono' else r end;
end $$;

-- Só as funções do link chamam estas duas. O Supabase dá "execute" ao anon em toda função nova do
-- public; sem este revoke, o link chamaria a conferência direto.
revoke execute on function public.conferir_palavra_do_dono(text) from public, anon, authenticated;
revoke execute on function public.quem_mexe(bigint, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. As três funções que o link chama.
-- ---------------------------------------------------------------------------------------------

-- "Sou o dono": a página confere a palavra uma vez e guarda no aparelho.
create or replace function public.sou_o_dono(p_palavra text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r text := public.conferir_palavra_do_dono(p_palavra);
begin
  return jsonb_build_object('ok', r = 'ok', 'motivo', r);
end $$;

-- Apaga a linha e libera as fotos dela para a página apagar do balde.
create or replace function public.apagar_inspecao(p_id bigint, p_segredo text default null, p_palavra text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  quem text := public.quem_mexe(p_id, p_segredo, p_palavra);
  l public.inspecoes_link;
  fotos text[];
begin
  if quem not in ('segredo', 'dono') then
    return jsonb_build_object('ok', false, 'motivo', quem);
  end if;
  delete from public.inspecoes_link where id = p_id returning * into l;
  fotos := array_remove(array[l.foto_1, l.foto_2], null);
  insert into public.fotos_a_apagar (caminho) select unnest(fotos) on conflict do nothing;
  delete from public.fotos_a_apagar where liberada_em < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'por', quem, 'fotos', to_jsonb(fotos));
end $$;

-- Troca só os campos do formulário: o ponto tocado, a origem, a data de criação e o hash ficam.
-- As regras (check) e a chave do ativo valem na edição como no cadastro: se uma recusar, o banco
-- devolve o mesmo erro 23514 ou 23503 e nada muda.
create or replace function public.editar_inspecao(p_id bigint, p_dados jsonb, p_segredo text default null, p_palavra text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  quem text := public.quem_mexe(p_id, p_segredo, p_palavra);
  antes public.inspecoes_link;
  novo public.inspecoes_link;
  soltas text[];
begin
  if quem not in ('segredo', 'dono') then
    return jsonb_build_object('ok', false, 'motivo', quem);
  end if;
  select * into antes from public.inspecoes_link where id = p_id;
  -- Chave que não veio no p_dados fica como estava.
  novo := jsonb_populate_record(antes, p_dados);
  update public.inspecoes_link set
    id_ativo = novo.id_ativo, atividade = novo.atividade, status = novo.status,
    data_planejada = novo.data_planejada, data_executada = novo.data_executada,
    responsavel = novo.responsavel, condicao = novo.condicao,
    nao_conformidade = novo.nao_conformidade, servico_realizado = novo.servico_realizado,
    materiais_equipamentos = novo.materiais_equipamentos, decisao = novo.decisao,
    proxima_data = novo.proxima_data, custo_rs = novo.custo_rs, observacao = novo.observacao,
    foto_1 = novo.foto_1, foto_2 = novo.foto_2, editado_em = now()
  where id = p_id
  returning * into novo;
  -- A foto trocada ou removida fica liberada para a página apagar do balde.
  select coalesce(array_agg(f), '{}') into soltas
    from unnest(array[antes.foto_1, antes.foto_2]) f
   where f is not null and f is distinct from novo.foto_1 and f is distinct from novo.foto_2;
  insert into public.fotos_a_apagar (caminho) select unnest(soltas) on conflict do nothing;
  return jsonb_build_object('ok', true, 'por', quem, 'linha', to_jsonb(novo) - 'segredo_hash', 'fotos', to_jsonb(soltas));
end $$;

revoke execute on function public.sou_o_dono(text) from public;
revoke execute on function public.apagar_inspecao(bigint, text, text) from public;
revoke execute on function public.editar_inspecao(bigint, jsonb, text, text) from public;
grant execute on function public.sou_o_dono(text) to anon, authenticated;
grant execute on function public.apagar_inspecao(bigint, text, text) to anon, authenticated;
grant execute on function public.editar_inspecao(bigint, jsonb, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. O balde: o link apaga só a foto liberada e que nenhuma inspeção usa mais. Sem a segunda
--    condição, quem apontasse a própria inspeção para a foto de outra e depois apagasse a sua
--    levaria a foto alheia junto.
-- ---------------------------------------------------------------------------------------------
create or replace function public.foto_liberada(p_nome text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fotos_a_apagar where caminho = p_nome)
     and not exists (select 1 from public.inspecoes_link where foto_1 = p_nome or foto_2 = p_nome);
$$;
revoke execute on function public.foto_liberada(text) from public;
grant execute on function public.foto_liberada(text) to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'fotos-inspecao: link apaga a liberada') then
    create policy "fotos-inspecao: link apaga a liberada" on storage.objects for delete to anon, authenticated
      using (bucket_id = 'fotos-inspecao' and public.foto_liberada(name));
  end if;
end $$;

-- Conferência: deve sair segredo_hash e editado_em na tabela, as três funções do link e a regra
-- nova do balde. "palavra_definida" fica false até rodar o 3_palavra_do_dono.sql.
select (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'inspecoes_link'
           and column_name in ('segredo_hash', 'editado_em'))                       as colunas_novas,
       (select count(*) from pg_proc
         where pronamespace = 'public'::regnamespace
           and proname in ('sou_o_dono', 'apagar_inspecao', 'editar_inspecao'))     as funcoes_do_link,
       (select count(*) from pg_policies
         where schemaname = 'storage' and policyname = 'fotos-inspecao: link apaga a liberada') as regra_do_balde,
       exists (select 1 from public.dono_brg4)                                       as palavra_definida;
