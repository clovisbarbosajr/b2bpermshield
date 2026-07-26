# Varredura do sistema — falhas encontradas e corrigidas (2026-07-26)

Revisão ampla do código (portal do cliente, telas de admin, edge functions e
triggers SQL) a pedido do dono: **corrigir só falhas reais, sem inventar
melhorias** — é um sistema de uso interno.

Foram levantados ~50 apontamentos. Cada um foi **verificado no código antes de
qualquer mudança**; **9 se confirmaram como falhas reais e foram corrigidos**
(commit `b059673`). O resto está na seção 3, com o motivo de não ter sido
mexido — serve de lista para você decidir depois.

---

## 1. Falhas de SEGURANÇA corrigidas

### 1.1 Anti-relay furado — email da empresa enviado a terceiros
`supabase/functions/send-email/index.ts`

O gate anti-relay validava `body.customerEmail`, mas os tipos de pedido
(`new_order_customer`, `order_status_change`) **enviam para `customer.email`** —
campo diferente. Como a chave anônima está no bundle do site, um cliente logado
podia mandar o **próprio** email no campo validado e o de um **terceiro** no
campo usado: o gate aprovava e o email saía com a marca da empresa **e o PDF do
pedido anexado**.

**Correção:** além do gate de entrada (mantido), foi adicionado um **gate final**
que valida o destinatário **já resolvido pelo roteamento**, imediatamente antes
do envio. Chamador privilegiado (service-role/cron) não passa por ele — os
fluxos internos seguem iguais.

### 1.2 BCC vazava link de acesso (takeover de conta)
`set_password`, `magic_link`, `request_magic_link` e `password_reset` estavam na
lista de tipos que recebem `bcc_outgoing_emails`. Ou seja: com um BCC
configurado (uso legítimo: arquivar confirmação de pedido), **todo link de
recuperação de senha e todo magic link do cliente também era entregue nessa
caixa compartilhada** — quem tivesse acesso a ela assumia a conta do cliente.

**Correção:** BCC nunca acompanha email que carrega link de acesso. O BCC
continua valendo para os emails de pedido/aprovação, e o logo continua em todos.

---

## 2. Falhas funcionais corrigidas

### 2.1 Cliente migrado não conseguia logar com o canal de email desligado
`request_magic_link` (o "me manda um link de login", usado por quem veio do
B2BWave sem senha) **faltava** na lista de tipos de auth isentos do interruptor
mestre de email. Com o canal Email OFF, a função respondia `{success:true}` e
**não mandava email nenhum** — falha invisível, impossível de diagnosticar. O
comentário do próprio código já dizia que auth não deve ser bloqueado; era
omissão. Corrigido.

### 2.2 Cliente recebia o código cru do status
Os mapas de rótulo de status no `send-email` só tinham os valores **legados em
português** (`recebido`, `processando`…). Os status atuais são
`submitted, ready_for_pickup, partial, on_hold, sent, complete, cancelled`
(fonte: `src/lib/orderStatuses.ts`), então caíam no fallback e o cliente lia:
> "Your order #2611 status has been updated to: **ready_for_pickup**"

**Correção:** adicionados os rótulos canônicos nos dois mapas, mantendo os
legados para pedidos antigos.

### 2.3 Carrinho do "View as" era o carrinho do ADMIN
`src/contexts/CartContext.tsx`

A chave do carrinho vinha da **sessão real** (a do admin), enquanto o usuário
durante a impersonação é sintético. Resultado: **todos os clientes vistos pelo
admin dividiam o mesmo carrinho**. Com o view-as por aba isso piora — duas abas
com clientes diferentes gravavam uma por cima da outra, dando para **enviar o
pedido do cliente A no nome do B**.

**Correção:** durante o view-as a chave é do **cliente impersonado**
(`b2b_cart_viewas_<id>`). Hidratação e persistência foram amarradas à chave
efetiva (`hydratedKeyRef`), então trocar de cliente não grava os itens do
anterior na chave nova. Fora do view-as, nada muda.

### 2.4 Cupom era consumido antes do pagamento
`src/pages/portal/Checkout.tsx`

`increment_coupon_usage` rodava logo após criar o pedido, **antes** do fluxo do
cartão. Cartão recusado → pedido cancelado, mas o cupom (de uso único) já tinha
sido queimado: o cliente não conseguia usar de novo e o admin via "usado 1x" sem
venda. **Correção:** o incremento virou função chamada só quando o pedido de
fato se concretiza — pagamento aprovado, ou submit no fluxo sem cartão.

### 2.5 Mudança de status: erro ignorado, cliente notificado assim mesmo
`src/pages/admin/OrderDetail.tsx`

O `update` do status não checava erro: a tela dizia "Status updated", o dropdown
mudava e o cliente **recebia o email** ("seu pedido foi enviado") mesmo quando o
banco recusava (RLS/rede) e o pedido continuava no status antigo. **Correção:**
erro reverte o dropdown, mostra a mensagem real e **não** notifica.

### 2.6 e 2.7 Carrinho: variantes se atrapalhando
`src/pages/portal/Carrinho.tsx`

- **Chave React duplicada:** as linhas usavam `key={item.produto_id}`, mas duas
  variantes do mesmo produto são linhas distintas → chaves iguais e o React
  embaralhava as linhas (valor digitado pulando de linha).
- **"Saved for later" apagava variante:** salvar/mover/remover filtrava por
  `produto_id`. Salvar "Camiseta M" e depois "Camiseta G" **descartava a M
  silenciosamente** (ela já tinha saído do carrinho) — perda de dado.

**Correção:** os dois passaram a usar `cartKey` (produto + variante), que já era
o padrão do resto do arquivo.

### 2.8 Campo trocado na notificação de pedido novo
O checkout mandava `customer_company: customerName` (o nome da **pessoa**) no
payload do `notify-dispatch`, nos dois caminhos (com e sem cartão). O admin
recebia "Customer: John Doe / Company: John Doe". Todos os outros pontos do
sistema já mandavam a empresa correta — era divergência só no checkout, que é o
de maior volume. Corrigido para `customerCompany`.

---

## 3. Apontamentos NÃO corrigidos (e por quê)

Verificados, mas deixados como estão — ou porque **não são falhas**, ou porque
mexer traz mais risco do que o problema, ou porque são **decisão de negócio**.
Listados para você decidir depois:

| Apontamento | Por que não mexi |
|---|---|
| **Email duplicado se marcar "Email" no evento** em Notifications → Events | O padrão do banco já vem sem email nesses eventos (migration de dedup). Só duplica se alguém marcar manualmente. Bloquear isso é **decisão sua** — dá pra remover a opção da tela, mas é mudar comportamento, não corrigir bug. |
| **Mudar status pela LISTA não manda email** (só pelo detalhe) | Comportamento inconsistente, mas mexer nisso muda o volume de emails de operações em lote. Decisão sua. |
| **`shipping_costs` digitado à mão é sobrescrito pelo trigger** | O trigger é **proposital** (frete autoritativo pela shipping option). O campo editável na tela é que ilude. Corrigir = mexer em regra de cobrança; não faço sem sua decisão. |
| **Totais da tela ficam desatualizados após Save** | O banco recalcula e a tela não relê. Incômodo real, mas cosmético (F5 resolve) e mexer no fluxo de save é arriscado. |
| **Paginação sobre 1000 linhas** (limite do PostgREST) | Só vira problema real quando passar de ~1000 pedidos/clientes. Ainda não é o caso; a correção é paginação no servidor, mudança grande. |
| **Profile salva a linha `configuracoes` inteira** | Pode reverter configurações de outra tela se duas pessoas editarem ao mesmo tempo. Cenário improvável no uso interno de vocês; a correção mexe em todas as telas de settings. |
| **Reorder usa preço base e perde variante** | É melhoria de comportamento do "comprar de novo", não falha que quebra. O checkout recalcula o preço no envio, então não cobra errado. |
| **Estoque de variante não é descontado** | O sistema reserva estoque no produto-pai; variante é rótulo. É **decisão de modelagem**, não bug — mudar exige migration e regra nova. |
| **`notify-dispatch` aceita evento de qualquer usuário logado** | Risco baixo em sistema interno (exige estar logado). A correção é um gate por papel; anotei como possível endurecimento futuro. |
| **Vários `catch` mudos e erros não logados** | Não quebram nada hoje; são qualidade de diagnóstico. |
| **Trigger de low_stock não alerta em INSERT** | Por design (só alerta na transição acima→abaixo, pra não spammar no sync). |
| **SMS manda o status cru / "Order #0"** | Mesmo problema do 2.2, mas do lado do SQL. Exige rodar SQL novo; se quiser, faço a migration com os rótulos. |

---

## 4. Verificação feita (para não quebrar nada)

- **Typecheck** do frontend: limpo.
- **Bundle** das edge functions (`send-email`, `generate-pdf`): OK.
- **App rodando**: sem erros de console nem de servidor; carrinho anônimo
  funcionando (sem regressão na mudança do CartContext).
- Cada correção foi feita **depois** de confirmar o problema lendo o código —
  nenhuma foi aplicada só com base no relatório da varredura.

**Limitação honesta:** sem credenciais de admin/cliente, os fluxos logados
(finalizar pedido com cupom, mudar status, view-as com carrinho) não foram
exercitados de ponta a ponta. As correções são pontuais e verificadas por
leitura + tipos + build, mas o teste real de uso continua valendo a pena.

---

## 5. Deploy

- **SQL:** nada novo nesta rodada.
- **Publish no Lovable:** frontend **e** a edge function `send-email`
  (commit `b059673`). O `generate-pdf` também está pendente desde a limpeza de
  código morto (`8da07ea`).
- Ordem padrão: 1º SQL (não há), 2º publish.
