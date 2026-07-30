# 3 problemas — 2026-07-30

## 1 e 2. Override manual de preço na ordem

**Pedido:** "em ordens, coloca uma opção pra editar esse preço manualmente, tipo
override e deixar eu editar. Pq de vez em quando o Paulo faz uns preços
especiais."

**Antes:** a coluna *Price* da tabela Products em `OrderDetail.tsx` era texto
puro (`{fmt(item.preco_unitario)}`) — só dava pra mudar o preço apagando e
readicionando o item, e o preço voltava a ser o da tabela do cliente (o trigger
`trg_pedido_item_preco` é `BEFORE INSERT` e sobrescreve).

**Agora:**
- `src/pages/admin/OrderDetail.tsx` — a célula *Price* é um `<Input type=number>`
  editável. Salva no `blur` ou no `Enter`, grava `preco_unitario` + `subtotal` da
  linha, checa o erro do banco e recarrega a ordem (`loadOrder()`) pra mostrar os
  totais que o banco recomputou. Se o valor não mudou, não faz request.
- `supabase/migrations/20260730120000_recompute_subtotal_on_item_update.sql` —
  `trg_pedido_recompute_subtotal` era `AFTER INSERT OR DELETE`; **não disparava
  em UPDATE**. Sem isso, mudar o preço do item deixava `pedidos.subtotal` (e por
  consequência desconto/imposto/total) com o valor velho. Agora inclui `UPDATE`.

**Por que o override não é sobrescrito:** o trigger de preço autoritativo
(`trg_pedido_item_preco`) roda só no `BEFORE INSERT`. Em `UPDATE` o banco aceita
o valor do admin.

## 3. Erro ao entrar como cliente ("View as")

Duas causas, as duas fechadas:

1. **`gen_random_bytes` fora do search_path** — já corrigido em
   `20260727120000_fix_view_as_token_gen.sql` (usa `gen_random_uuid()`).
   Esse SQL precisa estar rodado.
2. **A aba nova chamava a RPC antes de restaurar a sessão do admin** —
   `consume_view_as_token` exige `admin_user_id = auth.uid()`. Na aba nova o
   `supabase-js` ainda estava lendo a sessão do `localStorage` quando o effect
   disparava; a chamada saía com a anon key e o banco devolvia
   *"Invalid or expired token"* — e o token já ficava queimado. Além disso o
   `React.StrictMode` roda o effect **duas vezes** em dev: a 1ª consumia o token
   e a 2ª sempre falhava.

   `src/pages/ViewAsRedirect.tsx`: agora espera `supabase.auth.getSession()`
   antes da RPC, usa um `ref` pra garantir **uma única** tentativa, e em caso de
   falha **mostra a mensagem de erro na tela** com um botão "Back to Customers"
   em vez de redirecionar calado pro `/login`.

## Ordem de deploy

1. SQL: `20260730120000_recompute_subtotal_on_item_update.sql`
   (e confirmar que `20260727120000_fix_view_as_token_gen.sql` já rodou)
2. Publish
