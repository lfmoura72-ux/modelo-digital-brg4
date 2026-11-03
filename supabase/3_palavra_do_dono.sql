-- A palavra-código do dono, para apagar e editar qualquer inspeção pelo link ("Sou o dono").
--
-- Como usar, depois do 2_apagar_e_editar.sql:
--   1. SQL Editor → New query, colar este arquivo inteiro.
--   2. NO EDITOR (não neste arquivo), trocar TROQUE-PELA-PALAVRA pela palavra-código, entre as aspas
--      simples. Pelo menos 10 letras; um apóstrofo dentro dela se escreve dobrado ('').
--   3. Run. Deve sair "palavra_definida: true".
--   4. Fechar a aba da query sem salvar. O SQL Editor guarda o histórico do que rodou: se a query
--      ficar salva com a palavra escrita, apague-a da lista.
--
-- O banco guarda só o hash (bcrypt): nem o banco sabe a palavra de volta. Para trocar, rode de novo
-- com a palavra nova; a velha deixa de valer na hora. Os aparelhos que guardaram a velha pedem a nova.

do $$
declare
  palavra text := 'TROQUE-PELA-PALAVRA';
begin
  if palavra = 'TROQUE-PELA-PALAVRA' then
    raise exception 'Troque TROQUE-PELA-PALAVRA pela palavra-código antes de rodar.';
  end if;
  if char_length(palavra) < 10 then
    raise exception 'A palavra-código precisa ter pelo menos 10 letras (tem %).', char_length(palavra);
  end if;
  insert into public.dono_brg4 (id, palavra_hash)
  values (1, extensions.crypt(palavra, extensions.gen_salt('bf', 10)))
  on conflict (id) do update set palavra_hash = excluded.palavra_hash, definida_em = now();
  delete from public.tentativas_do_dono;
end $$;

select exists (select 1 from public.dono_brg4) as palavra_definida,
       (select definida_em from public.dono_brg4 where id = 1) as definida_em;
