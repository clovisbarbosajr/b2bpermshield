-- ============================================================================
-- `clientes.disable_ordering` passa a BLOQUEAR pedido (hoje nao faz nada)
--
-- A coluna existe desde 20260319192534, e editavel na tela do cliente
-- (`src/pages/admin/CustomerEdit.tsx:227`), e filtravel na lista
-- (`src/pages/admin/Clientes.tsx:93`), vem sincronizada do B2BWave e ate esta
-- protegida contra edicao pelo cliente (`fn_lock_privileged_cliente_cols`,
-- 20260801130000:182).
--
-- So que NINGUEM a le. Procurada em todo o `src/`, `supabase/functions/` e nas
-- 158 migrations: nao aparece em nenhum gatilho, nem no checkout, nem em
-- policy. O dono marca "disable ordering" num inadimplente, a tela confirma, e
-- o cliente continua comprando normalmente.
--
-- E o caso mais perigoso de funcionalidade fantasma: nao e uma tela que nao faz
-- nada e se percebe. E um controle que o dono ACREDITA ter.
--
-- CONSERTO: entra no gatilho que ja existe para conta inativa
-- (`fn_block_order_inactive_customer`, 20260623020000:45), com as MESMAS
-- isencoes — sync, service_role, admin e manager passam, para o dono poder
-- lancar pedido manual de um cliente bloqueado se quiser.
--
-- ROLLBACK e VERIFICACAO no fim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BACKUP / DIAGNOSTICO — quem esta marcado hoje e vai passar a ser barrado.
-- Rode ANTES: se a lista tiver alguem que voce NAO quer bloquear, desmarque
-- antes de aplicar.
--
--   SELECT id, nome, email, status, is_active, disable_ordering
--   FROM public.clientes
--   WHERE disable_ordering IS TRUE
--   ORDER BY nome;
--
-- E quantos pedidos essas contas fizeram enquanto o controle estava morto:
--
--   SELECT c.nome, count(*) AS pedidos, max(p.created_at) AS ultimo
--   FROM public.pedidos p JOIN public.clientes c ON c.id = p.cliente_id
--   WHERE c.disable_ordering IS TRUE AND p.b2bwave_order_id IS NULL
--   GROUP BY c.nome ORDER BY pedidos DESC;
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_block_order_inactive_customer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _st text; _act boolean; _blk boolean;
BEGIN
  IF NEW.b2bwave_order_id IS NOT NULL
     OR auth.role() = 'service_role'
     OR public.has_role(auth.uid(),'admin')
     OR public.has_role(auth.uid(),'manager') THEN
    RETURN NEW;
  END IF;

  SELECT status::text, is_active, disable_ordering
    INTO _st, _act, _blk
  FROM public.clientes WHERE id = NEW.cliente_id;

  -- Denylist conservadora, como estava: status desconhecido NAO bloqueia, para
  -- nao derrubar cliente legitimo com status novo.
  IF _act IS FALSE
     OR lower(coalesce(_st,'')) IN ('pendente','inativo','rejeitado','suspenso','pending','inactive','rejected','suspended','blocked') THEN
    RAISE EXCEPTION 'This account is not active yet. Please wait for approval.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- NOVO. Mensagem SEPARADA de propósito: "aguarde aprovacao" mandaria o cliente
  -- esperar por algo que nunca vem — a conta esta ativa, o que foi suspenso e a
  -- compra. Token no inicio para o front reconhecer sem casar texto.
  IF _blk IS TRUE THEN
    RAISE EXCEPTION 'ORDERING_DISABLED: ordering is currently disabled for this account. Please contact us.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK — reinstala a versao anterior (sem a checagem de disable_ordering).
--
--   CREATE OR REPLACE FUNCTION public.fn_block_order_inactive_customer()
--   RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $x$
--   DECLARE _st text; _act boolean;
--   BEGIN
--     IF NEW.b2bwave_order_id IS NOT NULL
--        OR auth.role() = 'service_role'
--        OR public.has_role(auth.uid(),'admin')
--        OR public.has_role(auth.uid(),'manager') THEN
--       RETURN NEW;
--     END IF;
--     SELECT status::text, is_active INTO _st, _act FROM public.clientes WHERE id = NEW.cliente_id;
--     IF _act IS FALSE
--        OR lower(coalesce(_st,'')) IN ('pendente','inativo','rejeitado','suspenso','pending','inactive','rejected','suspended','blocked') THEN
--       RAISE EXCEPTION 'This account is not active yet. Please wait for approval.'
--         USING ERRCODE = 'check_violation';
--     END IF;
--     RETURN NEW;
--   END; $x$;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- VERIFICACAO
--
-- 1) A funcao tem a checagem:
--   SELECT prosrc LIKE '%ORDERING_DISABLED%' AS tem_checagem
--   FROM pg_proc WHERE proname = 'fn_block_order_inactive_customer';
--   -- esperado: true
--
-- 2) CONTROLE — o caminho bom precisa continuar funcionando: cliente ATIVO e
--    sem `disable_ordering` tem de fechar pedido normalmente. Se so testar o
--    bloqueio, um gatilho que recusa TODO mundo passaria no teste.
-- ---------------------------------------------------------------------------
