# 3ª varredura do sistema — 2026-07-26

Terceira passada, com 5 agentes cobrindo o que ainda não tinha sido varrido:
relatórios/estoque, importadores restantes, **triggers de negócio do banco**,
API pública/notificações e libs/componentes compartilhados.

**7 falhas corrigidas** (commits `b88182c`, `2fdfe53`, `4c711bc`).
**3 achados CRÍTICOS em triggers do banco NÃO foram corrigidos** — estão na
seção 3, com diagnóstico completo. Explico o porquê lá.

---

## 1. Corrigido

### 1.1 Update em massa alterava o pedido errado (`BulkUpdateOrders`)
O update era `.eq("numero", ...)` e **`pedidos.numero` não é único** — a própria
migration do sync diz isso, e já houve colisão real entre a numeração nativa e
ids do B2BWave. Uma linha do CSV alterava **todos** os pedidos com aquele
número (inclusive de outro cliente) e reportava "Updated" em verde; só o caso
"nenhum encontrado" era tratado. Agora resolve o número para **um id** antes;
número ambíguo vira erro sem tocar em nada.

### 1.2 Gráfico "Monthly Sales" mostrava os 12 meses MAIS ANTIGOS
A chave do agrupamento era o rótulo ("Jul 2026") e o `slice(-12)` cortava pela
ordem de **inserção**; como os pedidos vêm em ordem decrescente, o gráfico
plotava o **início do histórico**, com o eixo invertido. Agora usa chave
ordenável (`YYYY-MM`) e ordenação cronológica.

### 1.3 "Top Products by Revenue" incluía pedidos CANCELADOS
Enquanto a receita total os excluía — dois números do mesmo painel se
contradiziam. Passou a excluir.

### 1.4 Ajuste de estoque gravava histórico de algo que não aconteceu
`Estoque.tsx` gravava `estoque_log` + activity log e mostrava "Stock updated"
**independente** de o update dar certo. Com uma falha de RLS/rede, o histórico
registrava "100 → 250" e o estoque continuava 100. Agora o update vem primeiro
e é checado.

### 1.5 Sync revertia o status alterado pelo admin (e notificava o cliente)
O `statusMap` do `b2bwave-sync` gravava os status **legados em português**
(`enviado`, `concluido`) enquanto o app grava os canônicos (`sent`, `complete`).
Como o diff compara string crua, a cada ciclo do cron (15 min) o sync via
`"sent" != "enviado"` e **revertia** a mudança do admin — e a reversão disparava
o trigger de notificação, mandando ao cliente uma **segunda** mensagem com o
valor interno cru ("Order #123: recebido"). Mapa alinhado com
`src/lib/orderStatuses.ts`.

### 1.6 PhoneInput corrompia número colado (SMS ia para o número errado)
Colar `+15618498555` trazia o DDI junto: o "1" virava dígito do assinante e o
corte no limite comia o último dígito real → salvava `+11561849855`
(inexistente). Pior: o número corrompido **passava na validação**. Agora remove
o DDI quando há dígito a mais, e trocar de país re-clampa no limite do país novo.

### 1.7 REVOKE das RPCs de view-as estava inócuo (correção de erro meu)
Na migration anterior escrevi `REVOKE ... FROM anon`, que **não remove** o
`EXECUTE` herdado de `PUBLIC`. Comprovado em teste: com a chave anônima a função
ainda executava. Sem impacto real (o gate `admin_user_id = auth.uid()` já
barrava), mas a camada extra faltou. Migration `20260726130000` corrige com
`REVOKE FROM PUBLIC` + `GRANT` para `authenticated`.

---

## 2. ⚠️ Ainda pendente de SQL

Rodar no Lovable (se ainda não rodou o segundo):

```sql
REVOKE EXECUTE ON FUNCTION public.consume_view_as_token(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.consume_view_as_token(TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_view_as_token(UUID)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_view_as_token(UUID)  TO authenticated;
```

---

## 3. 🔴 CRÍTICOS encontrados nos triggers — NÃO corrigidos (leia antes de decidir)

Estes três mexem no **núcleo financeiro/estoque** do banco. Não os corrigi
porque a correção exige SQL delicado que **eu não consigo testar** sem acesso ao
banco — e o risco de quebrar cobrança/estoque é maior que o de deixá-los mais
alguns dias. Recomendo uma rodada dedicada, com backup antes.

### 3.1 Estoque reservado vaza quando o pedido tem 2 linhas do MESMO produto
`20260623020000_clientes_column_lock_and_stock_guard.sql` (`fn_adjust_stock_on_order_status`)

```sql
UPDATE produtos p SET estoque_reservado = GREATEST(0, p.estoque_reservado - pi.quantidade)
FROM pedido_itens pi WHERE pi.pedido_id = NEW.id AND p.id = pi.produto_id;
```

No Postgres, `UPDATE ... FROM` com join que casa **N linhas aplica só uma**
(arbitrária). Mas a reserva é `FOR EACH ROW` — soma **todas**. Assimetria
garantida.

**É alcançável no fluxo normal:** o carrinho separa linhas por
`produto_id::variante_id`, então duas variantes do mesmo produto viram duas
linhas de `pedido_itens` com o mesmo `produto_id`.

- Pedido "Camiseta M" ×3 + "Camiseta G" ×2 → reserva 5. Cliente cancela →
  devolve só 3 → **2 unidades ficam reservadas para sempre**.
- No status "complete", o mesmo problema baixa só uma linha do `estoque_total`
  → **estoque superestimado** (vende o que já saiu).

**Correção sugerida (a validar):** trocar o join por subquery agregada
(`SUM(quantidade) GROUP BY produto_id`) nos três ramos.

### 3.2 Cupom se auto-invalida e AUMENTA o total de um pedido já pago
`20260623090000_authoritative_shipping_tax.sql` (`fn_pedido_total_appside`, `BEFORE INSERT OR UPDATE`)

O trigger revalida o cupom (`uso_atual < uso_maximo`, `data_fim >= now()`) em
**todo UPDATE** do pedido — mas o checkout incrementa o uso **depois** de fechar
o pedido.

- Cupom de uso único: cliente fecha pedido de $1.000 com 10% → paga **$900**.
  Uso vai a 1. Dias depois o admin muda o status → o trigger reavalia, vê
  `1 < 1` falso → **zera o desconto e o total vira $1.000**. O pedido pago fica
  $100 acima do cobrado; PDF, e-mail e relatórios divergem do que foi recebido.
- Mesmo efeito quando o cupom expira: a primeira mudança de status apaga o
  desconto retroativamente.

**Correção sugerida (a validar):** revalidar o cupom **apenas no INSERT**; em
UPDATE, preservar o desconto já gravado.

### 3.3 Cliente pode zerar o próprio imposto
`tax_customer_group_id` **não está** na lista de colunas travadas do
`fn_lock_privileged_cliente_cols` (que protege `tabela_preco_id`, `status`,
`can_confirm_order`…), e a policy permite o cliente atualizar a própria linha.

Um `PATCH` na própria ficha trocando esse campo para um grupo isento faz
`sales_tax = 0` em todos os pedidos futuros. O comentário do próprio arquivo diz
que a intenção era travar exatamente esse tipo de coluna — foi esquecida.

**Correção sugerida:** incluir `tax_customer_group_id` na lista de colunas
restauradas pelo trigger. É a mais simples das três.

---

## 4. Outros achados NÃO corrigidos (menor gravidade)

| Achado | Observação |
|---|---|
| **Limite de 1000 linhas em quase todos os relatórios** | Todo relatório de vendas subnotifica acima desse volume, sem avisar. Correção = paginação no servidor, mudança grande. |
| **Comissão de representante calculada sobre `total`** (com imposto e frete) em vez de `subtotal` | Paga ~13% a mais por pedido. **É regra de negócio — me diga qual é a correta.** |
| **Filtro de data "From" em UTC e "To" em local** nos relatórios | O primeiro/último dia do período puxa ou perde pedidos. |
| **API pública provavelmente responde 404** (o roteamento casa o `v1` da plataforma) | Só funciona atrás de proxy/domínio custom. Confirmar se a API é usada. |
| **`ImportsLog` lê colunas que não existem** | A tela de auditoria mostra "0/0" para todo import. |
| **Parsers CSV ingênuos** em 5 importadores | Campo com vírgula entre aspas desalinha as colunas (o parser correto já existe em `ImportRelatedProducts`). |
| **`ImportRelatedProducts` apaga os relacionados antes do insert** | Se o insert falha ou nenhum código casa, os vínculos somem. |
| **Mapas sku→id com "último vence"** (SKU não é único) | Preço/item pode ir para o produto errado. |
| **Item adicionado a pedido cancelado reserva estoque que não volta** | Fluxo de admin. |
| **`increment_coupon_usage` não é idempotente** | Cliente autenticado pode queimar o saldo do cupom em loop. |
| **Check-in de produção com 0** consome a transição sem somar estoque | Sem caminho de correção pela UI. |
| **RichTextEditor: não dá para limpar o template** (o padrão volta sozinho) | Contorna-se pelo modo "Edit HTML source". |
| **Desconto por data expira 1 dia antes** (timezone) | Mesmo bug no cálculo do banco, então não há divergência tela×cobrança. |

---

## 5. Verificação

- **Typecheck** limpo; **bundle** das edge functions OK; app sem erros de
  console/servidor.
- Testado contra o seu banco real (sem login): as RPCs de view-as rejeitam
  chamada sem admin, e a guarda de impersonação forjada continua expulsando.
- Cada correção foi aplicada **depois** de eu confirmar o problema no código.

**Limitação:** sem credenciais, os fluxos logados não foram exercitados de
ponta a ponta.

---

## 6. Deploy

- **SQL**: o bloco da seção 2 (se ainda não rodou).
- **Publish**: frontend + edge function **`b2bwave-sync`**.
