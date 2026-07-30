# Log de trabalho — PermShield

Diário append-only. **Regra do dono (30/jul/2026):** documentar EM PARALELO
qualquer passo, por menor que seja — ao iniciar algo, ao ficar aguardando algo,
ao editar algo. Entrada nova sempre no fim, com hora e estado.

Estados usados: `INICIADO` · `EDITADO` · `AGUARDANDO` · `FEITO` · `BLOQUEADO`

---

## 2026-07-30

### Pedido do dono (3 problemas)
1. e 2. Em Orders, permitir **editar o preço da linha manualmente** (override) —
   "de vez em quando o Paulo faz uns preços especiais".
3. Erro ao acessar **como cliente** ("View as") — resolver definitivamente.
Restrição: **sem explicações**, só o SQL a rodar; o publish é feito pelo dono no
Lovable.

| # | Hora | Estado | O que |
|---|---|---|---|
| 1 | — | `INICIADO` | Leitura de `OrderDetail.tsx` (tabela Products) — célula *Price* confirmada como texto puro `{fmt(item.preco_unitario)}`, sem edição possível |
| 2 | — | `INICIADO` | Leitura dos triggers: `trg_pedido_item_preco` (BEFORE INSERT) e `trg_pedido_recompute_subtotal` (AFTER INSERT OR DELETE) + `fn_pedido_total_appside` (BEFORE INSERT OR UPDATE em `pedidos`) |
| 3 | — | `EDITADO` | `src/pages/admin/OrderDetail.tsx` — nova função `saveItemPrice()`: grava `preco_unitario` + `subtotal` da linha, checa erro, atualiza `pedidos.subtotal`, chama `loadOrder()`; sai sem request se o valor não mudou |
| 4 | — | `EDITADO` | `src/pages/admin/OrderDetail.tsx` — célula *Price* virou `<Input type="number" min=0 step=0.01>`, salva no `blur` e no `Enter` |
| 5 | — | `EDITADO` | `supabase/migrations/20260730120000_recompute_subtotal_on_item_update.sql` — trigger passa a disparar também em `UPDATE` (antes só INSERT/DELETE, então mudar preço não recomputava subtotal/imposto/total do pedido) |
| 6 | — | `INICIADO` | Diagnóstico do problema 3: revisão de `ViewAsRedirect.tsx`, `Clientes.tsx:handleViewAs`, `AuthContext`, e das 6 migrations de `view_as_tokens` |
| 7 | — | `FEITO` | Causa A confirmada: `gen_random_bytes` (pgcrypto, schema `extensions`) invisível sob `SET search_path = public` — já corrigido em `20260727120000_fix_view_as_token_gen.sql` (usa `gen_random_uuid()`) |
| 8 | — | `FEITO` | Causa B encontrada: a aba nova chamava `consume_view_as_token` **antes** de o supabase-js restaurar a sessão do admin → saía com anon key → "Invalid or expired token", e o token queimava. Somado ao `React.StrictMode`, que roda o effect 2× em dev |
| 9 | — | `EDITADO` | `src/pages/ViewAsRedirect.tsx` — espera `supabase.auth.getSession()` antes da RPC; `useRef` garante **uma** tentativa; erro agora aparece na tela com botão "Back to Customers" em vez de redirect calado pro `/login` |
| 10 | — | `FEITO` | `npx tsc --noEmit` → **0 erros** (rodado após as edições de OrderDetail e de ViewAsRedirect) |
| 11 | — | `EDITADO` | `docs/PRECO-OVERRIDE-E-VIEW-AS-2026-07-30.md` — documento dos 3 problemas |
| 12 | — | `FEITO` | Commit `e40ab2c` — `feat(orders): override manual de preco na linha + fix View as em aba nova` |
| 13 | — | `AGUARDANDO` | **Dono rodar o SQL** (bloco `create_view_as_token` idempotente + trigger com `UPDATE`) e depois **publish** no Lovable. Ordem: **1º SQL, 2º publish** |
| 14 | — | `EDITADO` | Criado este `docs/LOG-TRABALHO.md` a pedido do dono (documentar cada passo em paralelo) |
| 15 | — | `EDITADO` | Memória: novo arquivo `documentar-em-paralelo.md` + índice em `MEMORY.md` — a regra passa a valer em qualquer conversa nova, não só nesta |
| 16 | — | `FEITO` | Commit da documentação (log + memória + doc dos 3 problemas) |
| 17 | — | `FEITO` | Dono rodou o SQL no Lovable — **sem retorno é o esperado**: `CREATE OR REPLACE FUNCTION`, `DROP/CREATE TRIGGER`, `REVOKE` e `GRANT` são DDL e não devolvem linhas |
| 18 | — | `FEITO` | Descoberto por que **não aparecia o botão de publish**: os commits `e40ab2c` e `a5efb6e` estavam só no repo LOCAL (`main` 2 commits à frente do `origin`). O Lovable só vê o código depois do push no GitHub. `git push` feito → `7e1f563..a5efb6e main -> main` |
| 19 | — | `AGUARDANDO` | Lovable sincronizar o push do GitHub e o **publish** ficar disponível; depois testar "View as" e o override de preço |

### Aguardando resposta do dono (arrastado de 26/jul)
- Decisão sobre as **3 críticas de trigger** (reserva de estoque com
  `UPDATE...FROM`, cupom revalidado em UPDATE, `tax_customer_group_id` fora do
  lock). Diagnóstico: `docs/VARREDURA-3-SISTEMA-2026-07-26.md` seção 3.
- **Comissão do representante**: sobre mercadoria (subtotal) ou sobre total
  (com imposto e frete)? Hoje usa `total`.
- A tela **OAuth Applications** é usada? Os defaults das colunas
  `client_id`/`client_secret` usam `gen_random_bytes` e podem falhar igual ao
  bug do View as.

### O que ainda não foi testado
- Override de preço **em produção** (só typecheck local; o dev server não foi
  usado com login de admin real).
- "View as" ponta a ponta depois do SQL — depende do publish.
