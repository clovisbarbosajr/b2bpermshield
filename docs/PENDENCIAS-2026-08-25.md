# Estado do projeto — 25/ago/2026 (fim do dia)

Este é o arquivo de estado. O histórico detalhado, com o raciocínio de cada
conserto e cada erro cometido no caminho, está em `LOG-TRABALHO.md`.

**A fila de defeitos acabou.** As levas A a H foram varridas e fechadas. O que
resta é (1) rodar SQL, (2) publicar, (3) duas decisões do dono.

---

## 1. O QUE FALTA FAZER — ordem exata

### 1.1 Rodar no SQL editor do Lovable, um por vez

Cada arquivo tem, dentro dele: consulta de **backup** para rodar antes, o
**rollback** e a **verificação**.

| # | Arquivo | Observação |
|---|---|---|
| 1 | `20260825320000_estoque_por_variante.sql` | **Fora de horário de pico** — trava a tabela de variantes durante o backfill e a vitrine espera |
| 2 | `20260825330000_item_produto_valido.sql` | |
| 3 | `20260825340000_log_auditoria_nao_forjavel.sql` | **Mandar o retorno do backup** — se vier linha, alguém já forjou |
| 4 | `20260825350000_trava_colunas_item.sql` | |
| 5 | `20260825360000_preco_exige_conta_liberada.sql` | **Ler a lista do backup** — são os clientes que perdem acesso à régua de preço |
| 6 | `20260825370000_view_as_diz_a_verdade.sql` | |
| 7 | `20260825380000_cupom_consumo_no_servidor.sql` | **Mandar o retorno do backup** — mostra o quanto deixou de ser contado |

> Se qualquer passo der erro, **pare** e avise. Não pule para o próximo.

### 1.2 Publish

### 1.3 Pedir deploy das edge functions no chat do Lovable

`send-email` · `stripe-checkout` · `register-customer` · `company-member` · `b2bwave-sync`

`b2bwave-sync` foi acrescentada depois: o `diff_orders` (a comparação de 1.4)
mudou cinco vezes nesta varredura. Rodar a comparação contra a versão antiga
publicada daria "idêntico" com o critério errado.

Push no GitHub **não** publica edge function. Sem este passo, as correções de
e-mail, pagamento, cadastro e equipe não entram.

### 1.4 Avisar, para eu rodar a comparação com o B2BWave

Duas comparações, as duas só leitura: `diff_orders` (pedidos) e
`diff_catalog` (produtos, variantes, régua de preço, clientes) — esta última criada em 25/ago,
porque a comparação antiga cobria só pedidos e o sync escreve 13 tabelas.
**`diff_catalog` nunca foi executada** — a primeira rodada é prova, não formalidade.

Comparo pedido a pedido, só leitura, sem enviar nada — conferido: o
`diff_orders` não tem `insert`/`update`/`upsert`/`delete`, e pagina os dois
lados (foi a falta de paginação que causou o incidente dos 1.508 SMS). **A sincronização só volta
depois disso, e a notificação só quando o dono mandar.**

---

## 2. DECISÕES DO DONO — travam trabalho meu

### 2.1 Durante a transição, quem manda no estoque?

Hoje o sync sobrescreve `produtos.estoque_total` com o número do B2BWave a cada
ciclo — e isso **apaga todo check-in de produção** feito aqui. Não consertei
porque a resposta muda o dia a dia da operação.

- *"O daqui manda"* → o sync para de escrever estoque no UPDATE (só no INSERT de
  produto novo).
- *"O do B2BWave manda"* → fica como está, e o check-in de produção precisa ser
  feito lá até o desligamento.

### 2.2 Produção creditar tamanho/cor

`producao_pedidos` não tem `variante_id` — a produção é registrada por produto.
Quando um container chega, o crédito vai para o produto inteiro e alguém precisa
distribuir entre os tamanhos na tela do produto.

Consertar significa a tela de produção passar a pedir o tamanho, o que **muda o
fluxo de trabalho**. Decisão do dono, e precisa acontecer antes do B2BWave ser
desligado.

### 2.3 Ainda não confirmado no painel

- **Rate limit for sending emails** está em **1000/hora**. Com cadastro aberto,
  são mil e-mails/hora ao alcance de qualquer um. Recomendado: **50**.

---

## 3. O QUE JÁ ESTÁ NO AR

12 migrations rodadas e conferidas (13/13 OK na verificação), mais o site
publicado. Resumo do que mudou:

**Acesso e segredo** — conta pendente não vê catálogo nem preço; gerente e
depósito não leem mais a chave do Stripe nem o token da API; régua de desconto
fechada; sequestro de ficha migrada com rede no banco e o toggle do Auth ligado;
cadastro público deixou de revelar quem é cliente e de disparar 3 mensagens por
chamada; PDF de pedido alheio fechado; troca de senha exige recuperação;
`stripe-checkout` confere de quem é o pedido; formulário de funcionário parou de
revelar nome de empresa.

**Dinheiro** — cupom vencido não dá mais desconto; cliente não escolhe o próprio
preço; pedido não nasce pago nem concluído; a tela compara o preço com o do banco
antes de fechar; "disable ordering" bloqueia de verdade; desconto do cliente e
taxa de pagamento saíram da tela (nunca foram aplicados).

**Perda de dado** — o export de produtos era um backup mentiroso (cortava em
1000); importar produtos relacionados apagava sem recriar; funcionário virava
irrestrito em silêncio; check-in de produção com zero era armadilha permanente;
três listas do cliente sumiam sem aviso; importadores de cliente e variante
duplicavam cadastro; leitor de CSV único nos 9 importadores; catálogo do cliente
terminava no milésimo produto.

**Telas que mentiam** — 15 diziam "salvo" sem ter salvado; 4 filtros de cliente
não filtravam; log de importação sempre vazio; um checkbox rotulado "View order"
escondia produtos da loja; 6 telas que não faziam nada saíram do ar.

**Cabeçalhos de segurança** — CSP, anti-clickjacking, cache. Testado servindo o
site com eles num navegador: a primeira versão quebrava as fontes.

---

## 3.1 DEFEITO ENCONTRADO, AGUARDANDO MEDIÇÃO

**Preço obsoleto nunca sai da régua.** `tabela_preco_itens` só recebe `upsert`
do sync — nunca `delete`. Preço **tirado** de uma régua no B2BWave continua
valendo aqui para sempre, e o cliente segue comprando pelo valor antigo.

Não consertei de propósito: apagar linha de preço automaticamente é destrutivo,
e uma leitura parcial da origem viraria "sumiram os preços do cliente". A
`diff_catalog` agora conta `obsoleto_aqui`. **Se vier zero, não há o que
consertar** — se não vier, o conserto é decisão sua, com o número na mão.

No mesmo bloco: `tabelas_sem_par_aqui` mostra régua da origem sem tabela de
mesmo nome aqui. O sync pula essas em silêncio; se aparecer nome nessa lista,
nenhum preço daquela régua está sendo gravado.

---

## 4. DÍVIDAS REGISTRADAS — conscientes, não esquecidas

| Item | Por que não foi feito |
|---|---|
| `nome_produto`/`sku` do item ainda são texto do cliente | Travar exigiria replicar em SQL a formatação da variante — segunda cópia de uma regra que diverge. É texto no documento, não decisão de preço ou acesso. Conserto certo: o servidor montar a linha do PDF a partir do produto |
| Pedido mínimo só é checado no navegador | O pedido é criado numa chamada e os itens em outra; no INSERT não há item para somar. Abuso de baixa gravidade — o cliente paga o que pediu |
| Enumeração por **tempo** de resposta no login por e-mail | E-mail inexistente responde em duas consultas; cliente ativo passa por RPC, geração de link e envio síncrono. Fechar exige responder antes de enviar (fila) |
| Cupom aplicado por UPDATE de staff não revalida | Só o INSERT valida. Risco interno (exige papel de staff) |
| Isenções por `b2bwave_order_id` em ~6 gatilhos | Concessão temporária à fonte externa. **Remover no desligamento do B2BWave** |
| Gatilhos que o sync aciona | Conferidos um a um em `scripts/checar-sync-preflight.py`; os 8 sem isenção automática têm veredito gravado lá. Rodar de novo antes de religar |
| Reserva presa se o pedido for apagado sem apagar itens antes | Herdado do comportamento do produto-pai; sem caminho de tela |

---

## 5. FORA DO ALCANCE

SPF, DMARC, CAA e DNSSEC foram apontados por scan externo em
`b2bpermshield.vercel.app` e `.lovable.app`. Nenhum dos dois é domínio do dono —
quem publica DNS ali é a Vercel/Lovable. Passam a valer quando apontar um domínio
próprio (SPF é o que evita o e-mail cair em spam).

**Com o dono, não comigo:** trocar a senha do admin `jess@zapsupplies.com`, que
está legível no histórico do git. Remover do arquivo não basta.

---

## 6. PORTÕES QUE PASSARAM A EXISTIR

Cada um nasceu de um erro meu que chegou perto do banco do dono. Rodam em
`npm test`.

- **`scripts/check-migrations.mjs`** — recusa corpo PL/pgSQL fora de bloco,
  dollar-quote aberto e `BEGIN;` sem `COMMIT;`. Nasceu porque uma substituição
  minha apagou o cabeçalho de duas funções e eu já tinha mandado rodar.
- **`scripts/check-edge.mjs`** — recusa nome fora de escopo nas edge functions.
  Nasceu porque movi uma constante e passei a lê-la num escopo mais raso. Falhou
  em silêncio **duas vezes** antes de funcionar; as duas viraram correção nele.
- **`tsc -p tsconfig.app.json`** no `npm test` — o portão antigo apontava para um
  tsconfig que não checa nada e saía zero sempre.

**A regra que ficou:** portão novo só vale depois de um mutante provar que ele
reprova. As três vezes que um portão meu falhou, o sintoma foi o mesmo — **saía
zero sem ter olhado**.
