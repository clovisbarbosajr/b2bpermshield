# Incidente 25/ago/2026 — 1281 SMS disparados em uma hora

**Causa: minha.** Alterei a sincronização com o B2BWave sem considerar o volume
que a alteração liberava.

## O que o cliente sentiu

- **1281 SMS** entregues ao mesmo celular, um por pedido antigo, dizendo
  "Order #NNNN: complete". 227 falharam.
- Cada falha gerou **um e-mail de alerta ao admin** — até 227 e-mails em poucos
  minutos, para o mesmo endereço, sem teto nenhum.
- Custo direto na conta Twilio. Fila do servidor de e-mail engasgada.

## Como aconteceu

1. A API de pedidos do B2BWave **ignora o parâmetro `page`** quando chamada como
   `orders.json?page=N` — a página 1 e a 2 devolviam os mesmos 9 pedidos. A forma
   correta é `orders.json?paginated=1&per_page=500`.
2. Todo o código testava `length < 500` para decidir "acabou". Com resposta de 9,
   o laço encerrava na primeira página. **O sync só via os 9 pedidos mais
   recentes** — bug antigo e silencioso, que também explica por que alteração
   feita no B2BWave em pedido antigo nunca chegava aqui.
3. Corrigi a paginação. O sync passou a enxergar **1.147 pedidos**.
4. Existe um gatilho no banco, `trg_order_status_notify`, que dispara notificação
   **a cada mudança de status** — e não distingue "o admin mudou" de "o sync
   reconciliou". A reconciliação mudou o status de ~1.147 pedidos de uma vez.
5. Um SMS por pedido.

O comentário do próprio gatilho avisava: *"Dispara em QUALQUER mudança real de
status (admin, sync, etc.)"*. Eu li e mesmo assim subi a correção sem calcular o
volume. Era previsível.

## O que parou o sangramento

Fila do `pg_net` esvaziada, canais e eventos de notificação desligados, gatilho
desabilitado, todos os `cron` removidos. Depois disso, zero envios saindo daqui —
o que continuou chegando era a fila da Twilio drenando. **Mensagem já aceita pela
Twilio não pode ser cancelada por API** (só as em estado `scheduled`, via
Messaging Service); a documentação deles é explícita.

## Travas criadas (`20260825180000_teto_notificacao.sql`)

| Trava | O que faz |
|---|---|
| Supressão em massa | O sync avisa o banco antes de um lote e o gatilho não dispara. Se o processo morrer no meio, o contador fica órfão e o silêncio dura até 120 minutos depois do início — não até o fim da janela pedida. |
| Teto horário síncrono | 20 pedidos/hora para `order_status`, 10 para `low_stock`. Contador incrementado na mesma transação do UPDATE — vale desde o primeiro pedido do lote. |
| Teto no alerta ao admin | 5/hora. Era 1 e-mail por falha, sem limite. |
| Gatilho desligado | O SQL deixa o gatilho desabilitado. Religar é passo manual, verificado. |

Uma versão anterior destas travas foi **reprovada na revisão** e não chegou a ser
executada. Os defeitos: a supressão existia mas ninguém a chamava; o teto lia o
`notification_log`, que só é escrito 1-3 s depois, e deixaria passar ~100 SMS
antes de engatar; e o `ENABLE TRIGGER` no fim podia abortar a migration inteira.

## Regras que ficam

1. **Nenhuma operação que toca mais de um pedido notifica.** Está no cabeçalho de
   `supabase/functions/b2bwave-sync/index.ts` como primeira coisa do arquivo.
2. **O teto é alarme, não licença.** Se ele engatar, alguém já recebeu mensagem
   errada — investigue, não aumente o número.
3. **Teto de gasto na Twilio** (Billing → Usage triggers) é a única proteção que
   não depende deste código estar certo.
4. **Antes de qualquer correção que aumente o alcance de um laço**, contar quantas
   linhas ele passa a tocar e o que dispara por linha.

## Sobre o servidor de e-mail

O provedor relatou 1444 e-mails congelados. O `notification_log` mostra volume de
e-mail entre 0 e 26 por dia no período — nenhum pico. O caminho de amplificação
que **existe** aqui é o alerta de falha ao admin (1 por falha, sem teto até
agora), que no incidente pode ter gerado até 227 mensagens. Se o provedor
informar remetente e horário dos congelados, dá para fechar essa conta. A
verificação independente é o painel do Resend, que lista todo e-mail enviado.
