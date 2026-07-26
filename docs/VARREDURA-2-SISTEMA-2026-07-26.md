# 2ª varredura do sistema — 2026-07-26 (commit `a3e73fd`)

Segunda passada, cobrindo as áreas que a 1ª não tocou: **Produção, produtos/
importadores, autenticação/cadastro, RLS+migrations, portal do cliente
(catálogo/pedidos/pricing) e settings + edge functions** (stripe, sync,
usuários).

Foram levantados ~70 apontamentos. Cada um foi **verificado no código antes de
mexer**; **12 se confirmaram como falhas reais e foram corrigidos**. O resto
está na seção 4, com o motivo de não ter sido tocado.

---

## 1. 🔴 CRÍTICO — pagamento

### Era possível marcar o pedido de outra pessoa como pago
`supabase/functions/stripe-checkout/index.ts`

```ts
metadata: { pedido_id: pedido_id || "", ...metadata },   // ❌ metadata é do CLIENTE
```

O `metadata` vem do corpo da requisição (controlado pelo cliente) e, por estar
**depois** no spread, sobrescrevia o `pedido_id`. O **valor cobrado** sempre foi
lido do banco (correto), mas o `pedido_id` gravado no PaymentIntent — que o
webhook e o `confirm_payment` usam para marcar `is_paid` — era o do atacante.

**Cenário:** criar um pedido de $10, chamar a função passando o id de um pedido
de $50.000 no metadata, pagar os $10 → o pedido de $50.000 fica **pago**.
Variante destrutiva: um pagamento recusado marcava o pedido alheio como
`cancelled`.

**Correção:** `metadata: { ...metadata, pedido_id }` — o id do servidor vence.
Agora o metadata sempre aponta para o mesmo pedido que definiu o valor cobrado.

---

## 2. 🟠 Segurança

### 2.1 Token do "View as" podia ser usado por qualquer um (SQL)
`consume_view_as_token` não checava **nada** sobre quem chamava. O token viaja
na *query string* (`/view-as?token=...`), ou seja, fica em histórico, `Referer`
e logs — e a RPC é executável com a chave anônima, que é pública no site. Quem
obtivesse a string recebia `id, user_id, empresa, nome, email, tabela_preco_id`
de outro cliente.

**Correção (migration `20260726120000`):** só o **admin que criou** o token pode
consumi-lo, mais `REVOKE` do papel anônimo. **Não muda o fluxo real** — a aba
nova do "View as" roda na mesma sessão de admin que gerou o token.

### 2.2 `claim_customer_record` ficou de fora do fix do caso "Nextgen Flooring"
A migration de 16/07 fechou a função irmã (`ensure_my_cliente_record`), mas
essa continuou: **sem bloqueio de staff** (um login admin/manager podia se
atrelar a uma ficha de cliente — exatamente o bug que a migration alegava ter
fechado) e **sobrescrevendo o `user_id` de ficha que já tinha dono** (tomada de
conta: junto vão pedidos, endereços, price list e preços por cliente).

**Correção:** mesma trava de staff da irmã + só adota ficha **livre**
(`user_id IS NULL`).

### 2.3 Permissão de localização com falha "fail-open"
`src/pages/admin/settings/UsersManagement.tsx`

O `delete` + `insert` em `user_locations` não checava erro. Como **"sem
amarração" significa "vê TODAS as localizações"**, um insert que falhasse depois
do delete deixava o usuário **sem restrição nenhuma** — e a tela dizia "User
updated". Falha silenciosa que **ampliava** acesso.

No mesmo save, mais dois erros não checados: o `upsert` de papel/permissões e a
**troca de senha** (respondia "User updated" com a senha inalterada — o admin
passava ao funcionário uma senha que não funcionava).

---

## 3. 🟡 Perda de dados e correção

| # | Falha | Impacto |
|---|---|---|
| 5 | **Aba "Code & Price Variants" nunca salvava** (`ProductEdit.tsx`) — a tabela só era lida | Criar/editar/excluir variante sumia ao recarregar, com "Product saved" na tela |
| 6 | Os `delete`+`insert` de imagens, arquivos, descontos, preços por cliente, relacionados, opções, price lists e status rules **não checavam erro** | Insert falhando **apagava** os dados (o delete já tinha passado) e a tela dizia sucesso |
| 7 | Import de descontos gravava `preco: null` explícito | **Apagava o preço custom** do produto naquela tabela de preço |
| 8 | Import de clientes mandava sempre `status: pendente` + `is_active: false` | Reimportar a planilha **rebaixava todos os clientes aprovados** (perdiam acesso ao portal) e apagava nome/empresa ausentes do CSV |
| 9 | Sync do B2BWave gravava `estoque_reservado` do feed | Zerava o contador **local** dos triggers de reserva → disponível inflado → **vendia estoque já comprometido** |
| 10 | `resolveEnderecoEntregaId` não checava erro do insert | Devolvia "ok" com id nulo → pedido criado **sem endereço de entrega**, com mensagem de sucesso |
| 11 | Catálogo adicionava ao carrinho com o preço de **1 unidade** | Cliente via um preço no carrinho e o checkout cobrava outro (faixas de desconto por quantidade) |
| 12 | `_shared/pdfGenerator.ts` órfão e **desatualizado**, mas os comentários mandavam "sincronizar" com ele | Seguir aquilo **regrediria** o layout do PDF (voltaria "Customer", perderia a quebra de endereço) |

---

## 4. Apontamentos NÃO corrigidos (e por quê)

| Apontamento | Por que não mexi |
|---|---|
| **Webhook do Stripe pode nunca chegar** (`stripe-checkout` fora do `config.toml` → `verify_jwt` default) | **Vale checar com prioridade**, mas não dá para confirmar pelo repositório: o deploy pode ter sido feito com `--no-verify-jwt`. Se estiver mesmo bloqueado, um cliente que feche a aba após pagar fica com o pedido não marcado como pago. **Recomendo verificar no Lovable.** |
| **`numero` do pedido em corrida** (`MAX(numero)+1` sem lock, índice não-único) | Dois checkouts simultâneos podem gerar o mesmo número. Correção exige sequence/unique — mudança de schema com risco; e o volume de vocês torna a corrida improvável. |
| **`estoque_total` pode ficar menor que o reservado** (edição manual) | Precisa de regra de negócio sua (bloquear? avisar? ajustar?). |
| **Check-in de produção sem limite superior / com 0** | É regra operacional (quanto pode receber a mais?). Decisão sua. |
| **Sub-usuário: endereço em "Minha Conta" não aparece no checkout** | Escopos divergentes (`cliente_id` próprio × do pai). A correção certa depende da regra: endereço do funcionário deve ser da empresa? Preciso da sua definição. |
| **Funcionário removido continua conseguindo logar** | `delete` no Team só inativa; o login e o papel continuam. Fechar isso muda o fluxo de acesso — decisão sua (bloquear no `ProtectedRoute` por `status`/`is_active`). |
| **Cadastro com email já existente diz "sucesso"** | É o comportamento padrão do Supabase (não vaza existência de conta). Mudar tem trade-off de privacidade. |
| **Reorder usa preço base e perde variante** | Melhoria de comportamento; o checkout recalcula o preço no envio, então **não cobra errado**. |
| **Imposto: `is_default` múltiplo, alíquota amarrada à 1ª classe, saves sem checar erro** (`SalesTax.tsx`) | Achados plausíveis, mas mexer em imposto sem você validar a regra é arriscado. **Recomendo revisar essa tela numa próxima rodada dedicada.** |
| **Listas truncadas em 1000 linhas** (produtos, pedidos, clientes, exports) | Só vira problema real acima desse volume. |
| **Ciclo de categoria trava a tela** | Precisa reproduzir para confirmar; é preciso definir a regra (impedir descendente como pai). |
| **Uploads sem validação de tipo/tamanho; `client_secret` OAuth em texto puro** | Superfície interna, RLS admin-only. Endurecimento, não bug ativo. |
| **Vários `catch` mudos / erros não logados** | Qualidade de diagnóstico, não quebra. |

---

## 5. Verificação feita

- **Typecheck** do frontend: limpo.
- **Bundle** das 4 edge functions tocadas (`stripe-checkout`, `b2bwave-sync`,
  `send-email`, `generate-pdf`): OK.
- **App rodando**: sem erros de console nem de servidor.
- Cada correção foi aplicada **depois** de eu confirmar o problema lendo o
  código — nenhuma feita só com base no relatório da varredura.

**Limitação honesta:** sem credenciais, os fluxos logados (salvar produto com
variantes, importar planilha, pagar com cartão, view-as) não foram exercitados
de ponta a ponta. As correções são pontuais e verificadas por leitura + tipos +
build.

---

## 6. Deploy

**Ordem: 1º SQL, 2º publish.**

1. **SQL** — rodar a migration `20260726120000_harden_view_as_and_claim.sql` no
   runner do Lovable (as duas funções de segurança).
2. **Publish** — frontend **e** as edge functions **`stripe-checkout`**,
   **`b2bwave-sync`**, **`send-email`** e **`generate-pdf`**.

> A correção do Stripe (item 1) só vale depois do publish da `stripe-checkout`.
