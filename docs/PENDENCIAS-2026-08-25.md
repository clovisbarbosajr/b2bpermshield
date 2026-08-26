# Estado do projeto — 26/ago/2026

> **LEVA DE 26/ago — notificação e preço.** As 8 migrations de 25/ago já rodaram
> (confirmado: o Lovable regenerou os tipos com `cupom_consumido`,
> `estoque_reservado` e `conta_liberada_de`). Entrou uma leva nova de **8
> migrations** (`20260826010000` a `20260826080000`) fechando o vazamento do
> reimport e seis furos de dinheiro. Cinco rodadas de cético derrubaram **19
> coisas minhas** antes de a última voltar limpa.
>
> **ORDEM OBRIGATÓRIA, na mesma sessão:** 1) os 8 SQL · 2) push · 3) deploy de
> **`notify-dispatch` PRIMEIRO**, depois `b2bwave-sync` · 4) publish · 5) só por
> último, se quiser, abrir a torneira (`pausar_envios(false)`).
>
> A ordem entre as duas edge functions não é detalhe: a guarda `somente_admin`
> mora dentro do `notify-dispatch`. Subir o `b2bwave-sync` primeiro faz ele
> mandar a marca para um destinatário que ainda não sabe lê-la — o campo é
> ignorado e o cliente volta para a lista. O cron roda a cada 15 min, então a
> janela é real. E o pior não é o risco em si: é você **acreditar** que a
> proteção está de pé e decidir religar em cima dessa crença.
>
> Entre o bloco 6 e o publish o cupom fica sem funcionar no portal.
>
> **Não tocar no botão "Resume sending"** (tela de Notifications) antes do deploy
> das edge functions: ele abre a torneira geral, e com o sync antigo ainda no ar
> isso reabre o cenário de 25/ago.
>
> Página com os SQL: `PermShield-SQL.html`, na Área de Trabalho.
> Painel de travas: `docs/CONSULTA-ESTADO-NOTIFICACAO.sql`

---

## PENDÊNCIAS ABERTAS — 26/ago

### P1. As páginas novas ainda NÃO substituíram nada

`public/paginas/` (portal, login de admin, login de cliente, recuperação de
senha) está no GitHub, mas **não é a tela do sistema**. Dois motivos:

1. **As rotas já existem em React** — `App.tsx:143-151` serve `/`,
   `/admin-login`, `/customers-login` e `/reset-password` pelos componentes
   `LoginLanding`, `AdminLogin`, `CustomerLogin` e `ResetPassword`. Quem
   responde nesses caminhos é o app; os arquivos estáticos ficam em
   `/paginas/...` e ninguém chega neles pelo fluxo normal.
2. **Os formulários não autenticam** — `action="#"` e o `app.js` intercepta o
   envio, mostrando "Interface ready — connect this form to your authentication
   endpoint". Nenhuma chamada ao Supabase.

**Conserto certo:** levar o DESENHO (HTML/CSS) para dentro dos componentes React
que já existem, porque a lógica de login, sessão e recuperação já está feita e
testada neles. O caminho inverso — apontar as rotas para os arquivos estáticos —
jogaria fora a autenticação inteira.

Não fiz nada disso: o dono pediu para subir sem alterar. Está subido, intacto.

### P3. Domínio próprio — `b2b.permshield.com`

Pedido do dono (26/ago): sair de `b2bpermshield.lovable.app` /
`b2bpermshield.vercel.app` para **`b2b.permshield.com`**, com os caminhos de
admin e de cliente junto.

**Decisão que falta:** subdomínio ou caminho?

- `b2b.permshield.com/admin-login` e `/customers-login` — é o que o código já
  faz hoje, e não muda uma linha. Recomendado.
- `admin.b2b.permshield.com` — vira outro domínio, e aí cada um precisa de
  entrada de DNS, certificado e, principalmente, **entra separado na lista de
  redirecionamento do Auth**. Mais trabalho e mais lugar para errar.

**O que quebra calado se for esquecido — esta é a parte que importa:**

1. **Supabase Auth → Site URL e Redirect URLs.** O link de recuperação de senha
   e o de acesso único são gerados com essa URL **embutida**. Trocar o domínio
   sem atualizar essa lista faz todo e-mail de recuperação apontar para o
   endereço antigo. O cliente clica e não entra — e não há nada na tela que
   explique. É a falha mais provável desta mudança.
2. **SPF, DKIM e DMARC.** Hoje estão registrados como "fora do alcance" na
   seção 5 justamente porque o domínio não é do dono. Com `permshield.com` isso
   deixa de valer: passam a ser **dele**, e sem eles o e-mail do sistema cai em
   spam. Configurar junto, não depois de os clientes reclamarem.
3. **CSP em `vercel.json`.** Conferir se alguma diretiva referencia o host
   antigo.

**O que NÃO muda:** a URL do Supabase (`bnicfvxvyblzzatvursw.supabase.co`), que
aparece nos gatilhos do banco. É o endereço do banco, não do site.

**Ordem sugerida:** DNS → certificado → Auth (Site URL + Redirect URLs) → SPF/
DKIM/DMARC → publicar → testar recuperação de senha de ponta a ponta, com
e-mail real, antes de anunciar o endereço novo.

---

### P2. Cloudflare Turnstile nas telas de login e cadastro

Ideia do dono (26/ago): pôr o desafio do Cloudflare para bloquear robô sozinho e
sinalizar ao visitante que o site é protegido.

**Por que faz sentido aqui, e não é só enfeite:** o cadastro deste sistema é
ABERTO, e isso já apareceu como agravante em vários achados desta semana —
qualquer pessoa cria conta e passa a ter acesso autenticado. O Turnstile corta a
criação em massa na porta.

**Onde entra:** `/cadastro`, `/login`, `/admin-login` e a recuperação de senha.
Precisa dos dois lados — o widget na tela E a validação do token no servidor
(edge function), senão é decoração: sem a checagem do lado do servidor, um robô
simplesmente não carrega o widget e manda o POST direto.

**Depende de P1** se as telas forem trocadas: fazer nos componentes atuais e
depois refazer no desenho novo é trabalho dobrado.

---

# Estado anterior — 25/ago/2026 (fim do dia)

Este é o arquivo de estado. O histórico detalhado, com o raciocínio de cada
conserto e cada erro cometido no caminho, está em `LOG-TRABALHO.md`.

**A fila de defeitos acabou.** As levas A a H foram varridas e fechadas, e a
dívida do **pedido mínimo** (seção 4) foi paga depois — virou a 8ª migration.
O que resta é (1) rodar SQL, (2) publicar, (3) duas decisões do dono.

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
| 8 | `20260825390000_pedido_minimo_no_servidor.sql` | **Mandar o retorno do backup** — quantos pedidos já entraram abaixo do mínimo. Testar os dois lados depois |

> Se qualquer passo der erro, **pare** e avise. Não pule para o próximo.

### 1.2 Publish

### 1.3 Pedir deploy das edge functions no chat do Lovable

`send-email` · `stripe-checkout` · `register-customer` · `company-member` · `b2bwave-sync`

`b2bwave-sync` foi acrescentada depois: o `diff_orders` (a comparação de 1.4)
mudou cinco vezes nesta varredura. Rodar a comparação contra a versão antiga
publicada daria "idêntico" com o critério errado.

Push no GitHub **não** publica edge function. Sem este passo, as correções de
e-mail, pagamento, cadastro e equipe não entram.

### 1.4 Avisar — aí rodam as duas conferências

Na tela **B2B Wave Sync**, cartão **“Conferência — só leitura”**, dois botões:

| Botão | O que compara |
|---|---|
| **Comparar Pedidos** | pedidos, status, valores, pagamento e **as linhas** de cada pedido |
| **Comparar Catálogo** | produtos, tamanhos/cores, **régua de preço** e clientes |

Nenhuma das duas escreve nada, e nenhuma envia e-mail ou SMS. Clique nas duas e
me mande o resultado (tem botão de copiar).

Fora de conferência ficam só metadados de catálogo — categorias, marcas,
representantes, grupos de privacidade e atividades. Nenhum decide preço, estoque
ou acesso, e o próprio relatório diz isso no corpo.

> **Nenhuma das duas jamais foi executada.** A primeira rodada é prova, não
> formalidade — a `diff_catalog` tem ~430 linhas que nunca rodaram.

**A sincronização só volta depois disso, e a notificação só quando você mandar.**

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
| `nome_produto`/`sku` do item ainda são texto do cliente | **Reconferido em 25/ago: fica.** São lidos por 12 arquivos, entre eles 4 telas de relatório — trocar a origem do texto mexe em tudo isso. E o dano é só de documento: preço, produto, variante e quantidade da linha já são validados no servidor, então o cliente não muda dinheiro, estoque nem acesso; só o texto do próprio pedido. Conserto certo continua sendo o servidor montar a linha a partir do produto |

| Enumeração por **tempo** de resposta no login por e-mail | E-mail inexistente responde em duas consultas; cliente ativo passa por RPC, geração de link e envio síncrono. Fechar exige responder antes de enviar (fila) |
| Cupom aplicado por UPDATE de staff não revalida | Só o INSERT valida. Risco interno (exige papel de staff) |
| Isenções por `b2bwave_order_id` em ~6 gatilhos | Concessão temporária à fonte externa. **Remover no desligamento do B2BWave** |
| Gatilhos que o sync aciona | Conferidos um a um em `scripts/checar-sync-preflight.py`; os 8 sem isenção automática têm veredito gravado lá. Rodar de novo antes de religar |
| Reserva presa se o pedido for apagado sem apagar itens antes | **Reconferido em 25/ago: continua sem caminho vivo.** A tela do admin (`OrderDetail`) apaga os ITENS primeiro — nesse caminho o pedido pai ainda existe, o gatilho lê o status e devolve certo. O `pedido_rollback_checkout` só apaga pedido SEM itens. Sobra o `DELETE FROM pedidos` direto no SQL editor, que cascateia com o pai já invisível e não devolve — deliberado, para não devolver duas vezes |

---

## 5. FORA DO ALCANCE

SPF, DMARC, CAA e DNSSEC foram apontados por scan externo em
`b2bpermshield.vercel.app` e `.lovable.app`. Nenhum dos dois é domínio do dono —
quem publica DNS ali é a Vercel/Lovable. Passam a valer quando apontar um domínio
próprio (SPF é o que evita o e-mail cair em spam).

**Com o dono, não comigo:** trocar a senha do admin `jess@zapsupplies.com`, que
está legível no histórico do git. Remover do arquivo não basta.

---

## 5.1 PRÉ-VOOS — rodados por mim antes de te entregar SQL

Não entram no `npm test` (são Python; a suíte é Node — amarrar uma à outra
troca um risco por outro). São conferências deliberadas, e **os quatro já
rodaram sobre as 8 migrations pendentes**:

| Script | O que garante | Resultado |
|---|---|---|
| `scripts/conferir-colunas.py` | nenhuma coluna citada que não exista | **8 OK** |
| `scripts/conferir-regressao-funcao.py` | nenhuma refaz função e desfaz correção aplicada | **nenhuma desfaz** |
| `scripts/gerar-runbook.py` | o SQL do seu arquivo bate com o do repositório | **18 blocos conferidos** |
| `scripts/checar-sync-preflight.py` | nenhum gatilho novo dispara sobre os ~1.150 pedidos importados | **8 conferidos à mão, nenhum dispara** |

Os três primeiros nasceram de erro meu que chegou perto do seu banco; o quarto,
do incidente dos 1.508 SMS. Cada um foi provado com um mutante antes de eu
confiar nele.

> **Não edite `RODAR-NO-PERMSHIELD-parte2.md` à mão** — ele é gerado. Edite
> `scripts/gerar-runbook.py` e rode de novo.

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
