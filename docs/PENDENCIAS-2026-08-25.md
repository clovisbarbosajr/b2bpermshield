# Pendências — varredura de 25/ago/2026

Fila de correção, em ordem. Um item por vez: caçador acha, cético valida, só
avança quando parar de voltar erro. Foi empilhar mudança sem verificar que causou
o incidente dos 1281 SMS (`INCIDENTE-2026-08-25-sms.md`).

**O sistema ainda NÃO está no ar** (confirmado pelo dono em 25/ago). Isso muda a
urgência: nada aqui está sangrando hoje, mas tudo vira prejuízo no dia do lançamento.

---

## 1. Barreira de idade nas notificações — **FECHADO**

7 rodadas de revisão, 10 versões reprovadas. Ver `INCIDENTE-2026-08-25-sms.md`.

**Ressalva registrada pelo cético:** a marca `notificavel` é pegajosa — uma vez
`true`, nunca volta a `false` por idade. O teto fixo de 7 dias protege o *momento*
da importação, não a vida do pedido. Depois disso quem segura é
`sync_state.order_notify_max_age_days`, uma linha editável por SQL.

**Prova que falta:** um ciclo de sincronização real terminando com zero envios no
log. Nada foi testado rodando; foi tudo lido no código.

---

## 2. Vazamento de dado comercial entre clientes — **PRÓXIMO**

Confirmado no banco de produção (`SELECT ... FROM pg_policies WHERE qual='true'`),
não só nos arquivos. Estas tabelas são legíveis por **qualquer pessoa cadastrada**
— e o cadastro é aberto:

| Tabela | O que vaza |
|---|---|
| **`produto_descontos`** | Régua de desconto e **preço final de TODAS as tabelas de preço** |
| `produto_variantes` | Variantes e quantidade em estoque de produto privado |
| `produto_imagens`, `produto_arquivos` | Imagens e fichas técnicas de produto restrito |
| `produto_opcoes`, `produtos_relacionados`, `option_values` | Sortimento privado |
| `tax_classes`, `tax_rates`, `tax_rules`, `tax_customer_groups` | Regras de imposto (baixo) |

A migration `20260619170000_pricelist_isolation.sql` fechou as tabelas de preço e
**esqueceu `produto_descontos`**, que tem o mesmo formato e é usada na precificação.

---

## 3. Validação de cupom morta em 100% dos pedidos

Em `fn_pedido_total_appside`, a elegibilidade (`ativo`, datas, `uso_atual <
uso_maximo`) só é checada quando `TG_OP = 'INSERT'`. Mas
`fn_pedido_recompute_subtotal` faz `UPDATE pedidos SET subtotal` a cada item
inserido, e nesse UPDATE o cupom é reaplicado **sem nenhuma conferência**.

Resultado: cupom expirado, desativado ou de uso único esgotado gera desconto no
total final — que é o valor cobrado. Combinado com o item 2 (o cliente enumera
todos os cupons ativos), é a maior sangria aberta.

---

## 4. Preço exibido ≠ preço cobrado

O preço de cada linha é congelado quando o item entra no carrinho e nunca mais
relido. O recálculo autoritativo só roda **depois** do clique, e o valor do banco
vai direto para o Stripe sem nenhuma comparação com o que o botão exibia.

O front também não conhece `shipping_options.gratis_acima_de`, então em opção sem
condições a tela cobra frete e o banco grava zero — ou o inverso.

---

## 5. Estoque de variante nunca dá baixa

Nenhuma migration escreve em `produto_variantes.quantidade`. A reserva atômica só
olha o produto-pai. A validação por variante existe apenas em `src/lib/stock.ts`,
no navegador. Dois clientes compram o último tamanho M ao mesmo tempo e os dois
passam.

---

## 6. Três controles do dono que não fazem nada

`disable_ordering`, `minimum_order_value` e `clientes.discount` são editáveis na
tela, sincronizados do B2BWave, protegidos contra edição pelo cliente — e **nunca
lidos** no checkout nem em trigger. O dono bloqueia um inadimplente e ele continua
comprando.

---

## 7. Catálogo do cliente sem paginação

`src/pages/portal/Catalogo.tsx` — 4 queries sem `fetchAllRows`, que existe e é
usado em todas as telas de admin equivalentes. Acima de 1000 linhas o catálogo
termina no meio, sem erro. Pior na tabela de variantes: truncada, o item entra no
carrinho **sem tamanho/cor**.

---

## 8. `pedido_itens` aceita produto desativado ou privado

A policy de INSERT valida só a posse do pedido. Não valida `produtos.ativo` nem
privacidade — e `cliente_pode_ver_produto` também não olha `ativo`. Re-order ou
URL direta de produto descontinuado entra como pedido.

---

## 9. `stripe-checkout` sem autenticação nenhuma

`supabase/functions/stripe-checkout/index.ts` não checa usuário nem papel, e usa
service role. Hoje é inofensivo porque o Stripe está desligado (`stripe_enabled`).
**Corrigir ANTES de ligar o Stripe** — senão vira plataforma de card testing de
terceiros na conta do dono.

---

## 10. `send-email` monta PDF de pedido alheio

Os gates anti-relay validam o destinatário, nunca o conteúdo. `buildOrderPdf`
hidrata do banco com service role usando IDs do body, sem checar posse. Quem
obtiver um UUID de pedido recebe no próprio e-mail o PDF com nome, telefone,
endereço, itens e preços da vítima. Não é enumerável, o que reduz a gravidade.

---

## 11. Cabeçalhos de segurança ausentes (scan externo)

`b2bpermshield.vercel.app` não envia nenhum cabeçalho de segurança. Corrigível em
`vercel.json`, que hoje só tem `rewrites`:

- **Content-Security-Policy** ausente
- **Clickjacking** — sem `X-Frame-Options` nem `frame-ancestors`
- **Cache-Control** sem `no-store` em página autenticada
- Opcionais: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`

Cuidado ao montar a CSP: `connect-src` precisa liberar o Supabase
(`https://bnicfvxvyblzzatvursw.supabase.co`, incluindo websocket para realtime),
senão o app inteiro para de funcionar.

---

## Fora do alcance enquanto o domínio for de terceiro

SPF, DMARC, CAA e DNSSEC foram apontados pelo scan em `b2bpermshield.vercel.app` e
`b2bpermshield.lovable.app`. Nenhum dos dois é domínio do dono — quem publica DNS
ali é a Vercel/Lovable. Passam a valer, e aí importam de verdade (SPF é o que
evita o e-mail cair em spam), quando apontar um domínio próprio.

---

---

# LEVAS DE CORREÇÃO

Agrupadas por natureza: cada leva vai inteira ao caçador e ao cético. Ordem por
risco real, considerando que o sistema **ainda não está no ar**.

## Leva A — Acesso e segredo (bloqueia o go-live)

- **A1** Cadastro auto-aprovado vê o catálogo inteiro com preços. `handle_new_user`
  dá papel `cliente` a todo `signUp`, então o gate de `/pending-approval` nunca
  dispara e nenhuma rota do portal confere `clientes.status`.
- **A2** `warehouse`/`manager` leem a linha inteira de `configuracoes` — onde estão
  `stripe_secret_key`, `stripe_webhook_secret`, `smtp_password`, `email_api_key`.
- **A3** Sequestro de ficha migrada: `ensure_my_cliente_record` vincula por e-mail
  sem exigir e-mail confirmado.
- **A4** `register-customer` é oráculo público — respostas distintas revelam se um
  e-mail é staff, cliente ou inexistente.
- **A5** `company-member`: cliente não aprovado cria login para e-mail de terceiro
  e o captura como funcionário. Mensagens de erro revelam nome de empresa.
- **A6** Vazamento das tabelas satélite (`produto_descontos` e cia.) — SQL escrito,
  em revisão.
- **A7** `stripe-checkout` sem autenticação nenhuma (só importa ao ligar o Stripe).
- **A8** `send-email` monta PDF de pedido alheio a partir de IDs do body.
- **A9** `/reset-password` troca senha com qualquer sessão, não só a de recuperação.
- **A10** Enumeração de e-mail pelo cooldown do `request_magic_link`.

## Leva B — Dinheiro

- **B1** Validação de cupom morta em 100% dos pedidos.
- **B2** Preço exibido ≠ preço cobrado, sem comparação antes do Stripe.
- **B3** Taxa de pagamento (`taxa_percentual`, `taxa_valor`) nunca cobrada.
- **B4** `clientes.discount` nunca aplicado.
- **B5** Pedido mínimo não existe (nem global nem por cliente).
- **B6** `disable_ordering` não bloqueia nada.
- **B7** Frete: `tipo_regra` ("Per Item") ignorado — sempre cobra por pedido.
- **B8** Cupom com validade deslocada por fuso; `Max Uses = 0` vira ilimitado.
- **B9** Re-order usa preço base em vez da cascata de preço.
- **B10** `preco_final = 0` vira null no ProductEdit.

## Leva C — Dado perdido / corrompido

- **C1** Salvar produto regrava `estoque_total` com valor obsoleto — apaga
  recebimento de produção.
- **C2** `CustomerEdit`: delete+insert de privacidade/pagamento/frete sem checar
  erro. Apagar pagamento em silêncio **libera todos** os métodos.
- **C3** `ImportRelatedProducts` apaga vínculos antes de saber se vai recriar.
- **C4** `SetupApp`/`Profile` gravam a linha inteira de `configuracoes` e
  sobrescrevem o SMTP configurado em outra tela.
- **C5** `ImportCustomers` duplica cadastro (dedupe cortado em 1000, sem UNIQUE).
- **C6** Estoque de variante nunca dá baixa — oversell de tamanho/cor.
- **C7** `pedido_itens` aceita produto desativado ou privado.
- **C8** Pedido órfão se a aba morrer entre os dois inserts do checkout.
- **C9** `ImportOrders`: `quantity` sem validação — "abc" vira 1.

## Leva D — Ação silenciosa ("diz que fez e não fez")

12 telas com `await supabase...` sem checar erro seguido de `toast.success`
incondicional: `UsersManagement` (revogar acesso de staff, criar usuário,
localidades), `ShippingOptions` (padrão e delete), `OauthApplications`,
`Clientes` (deletar login), `CustomerEdit` (papéis e endereços), e os 7
importadores que descartam o log de auditoria.

## Leva E — Funcionalidade fantasma

Telas inteiras que não fazem nada: `ApiKeys` (a API real usa outro token),
`OauthApplications` (não existe endpoint OAuth), `ExtraFields`, `QuickLinks`,
`MeasurementUnit`, `PdfCatalog` (o gerador só aceita `pedido_id`). Mais 5 filtros
de `Clientes` que não filtram, `moeda`/`fuso_horario` sem leitor, e
`ImportProductVariants` que descarta preço e nome.

**Decisão necessária do dono:** implementar ou remover da tela. Manter é pior que
os dois — hoje ele acredita que tem controles que não existem.

## Leva F — Volume e paginação

Catálogo do cliente, export de produtos, e ~15 leituras de admin sem
`fetchAllRows`. Acima de 1000 linhas cortam em silêncio.

## Leva G — Rótulo e conversão

`ProductStatuses` com checkbox rotulado errado que **esconde produtos da loja**;
"Quantity" significando coisas diferentes em duas telas; datas com fuso
divergente entre portal e admin; `ImportsLog` lendo colunas que não existem.

## Leva H — Cabeçalhos de segurança

CSP, clickjacking e `Cache-Control` no `vercel.json`.

---

## Com o dono, não comigo

- **Trocar a senha do admin `jess@zapsupplies.com`** — está legível em
  `20260617215903_...sql`. Ele avisou que troca depois, porque o sistema não está
  no ar. Remover do arquivo não basta: o histórico do git guarda.
- **Confirmar se "Confirm email" está ligado** no Auth. Se estiver desligado, com
  cadastro aberto alguém se registra com o e-mail de um cliente migrado e herda a
  ficha dele — pedidos, endereços, tabela de preço.
