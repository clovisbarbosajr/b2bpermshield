# Decisões pendentes do dono — varredura de 30/ago/2026

> **Estado em 30/ago, fim do dia.** O dono rodou o diagnóstico e o **bloco 1 do
> SQL** (índice de `tax_rules`, os dois `CHECK` de percentual, os três índices de
> nome, e o gatilho anti-ciclo de `categorias`). Os itens **A2, A3, B4 (parcial) e
> B6 estão RESOLVIDOS** — ficam abaixo só como registro.
>
> Ficou de fora, e continua pendente: o índice único de `tabelas_preco.nome`.
> Ver a seção **A5**, acrescentada depois.

Tudo aqui é o que **eu não posso decidir nem executar sozinho**: exige SQL no
banco, mexe em RLS/permissão, ou é regra de produto.

Nada nesta lista está quebrado por causa da varredura — são coisas que a varredura
**encontrou**. O que dependia só de código já foi corrigido e commitado.

Ordem: o que bloqueia o lançamento primeiro.

---

## A. Bloqueia lançamento — dinheiro ou venda

### A1. Cartão recusado deixa o pedido vivo, o estoque preso e o cupom queimado

`supabase/functions/stripe-checkout/index.ts` carimba `payment_intent_id` no
pedido **no instante em que cria a intenção**, antes de qualquer confirmação. A RPC
`pedido_rollback_checkout` recusa desfazer qualquer pedido que tenha esse campo
(`RAISE 'ROLLBACK_PAID'`). Resultado no caminho `confirmError` — cartão recusado, o
caso mais comum do mundo: o desfazer é garantidamente morto, e o pedido fica
`submitted`, não pago, segurando estoque e cupom.

Existe um webhook `payment_intent.payment_failed` que cancela e devolve tudo — mas
só se `stripe_webhook_secret` estiver cadastrado. Sem ele, o estado ruim é
permanente.

**Decisão:** o `ROLLBACK_PAID` passa a distinguir `is_paid = true` de
`payment_intent_id NOT NULL AND is_paid = false` (permitindo desfazer no segundo
caso), **ou** o desfazer do cartão vira responsabilidade exclusiva do webhook — e
aí `stripe_webhook_secret` vira pré-requisito para ligar o Stripe?

*Hoje é inerte porque o Stripe está desligado e o sistema não está no ar.*

### A2. Duas regras de imposto para o mesmo par fazem o checkout mentir

`tax_rules` não tem `UNIQUE (tax_class_id, tax_customer_group_id)`. Com duas
regras, o `.maybeSingle()` do checkout ERRA, `taxRate` fica 0, e o banco — que
resolve com `LIMIT 1` — cobra o imposto de verdade.

A tela já recusa criar a duplicata, mas isso é guarda de cliente: duas abas ao
mesmo tempo ainda passam.

```sql
-- 1. VER se já existe duplicata (rode isto primeiro):
SELECT tax_class_id, tax_customer_group_id, count(*), array_agg(id)
FROM public.tax_rules
GROUP BY 1, 2 HAVING count(*) > 1;
```

**Se voltar vazio**, o índice entra direto:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS tax_rules_classe_grupo_uniq
  ON public.tax_rules (tax_class_id, tax_customer_group_id);
```

**Se voltar alguma linha**, me diga quais — decidir qual regra sobrevive é sua.

### A3. Alíquota e comissão sem faixa no banco

Não há `CHECK` em `tax_rates.percentual` nem em
`representantes.comissao_percentual`. As duas telas já limitam a 0–100, mas o
`CHECK` é o que impede reentrada por API ou SQL direto. Alíquota negativa faz o
gatilho **subtrair** do total, e o checkout nem imprime a linha (ela só aparece com
`salesTax > 0`) — some dinheiro sem rastro na tela.

```sql
-- Ver se já há valor fora da faixa:
SELECT id, nome, percentual FROM public.tax_rates WHERE percentual < 0 OR percentual > 100;
SELECT id, nome, comissao_percentual FROM public.representantes
  WHERE comissao_percentual < 0 OR comissao_percentual > 100;
```

**Se as duas voltarem vazias:**

```sql
ALTER TABLE public.tax_rates
  ADD CONSTRAINT tax_rates_percentual_faixa CHECK (percentual >= 0 AND percentual <= 100);
ALTER TABLE public.representantes
  ADD CONSTRAINT representantes_comissao_faixa CHECK (comissao_percentual >= 0 AND comissao_percentual <= 100);
```

### A4. O portal inteiro ignora `permitir_backorder`

O banco honra a flag: a reserva passa sem exigir saldo. O portal não a lê em lugar
nenhum — `lib/stock.ts` decide só por status e saldo, e a coluna nem entra nos
`select` do checkout. Produto marcado "allow backorder" com estoque 0 fica com o
botão desabilitado numa venda que o banco aceitaria.

**Decisão:** habilitar (o portal passa a respeitar a flag) ou manter bloqueado?
É a única desta seção que **habilita venda hoje bloqueada** — por isso não fiz
sozinho.

---

## B. Bloqueia lançamento — segurança e perda de dado

### B1. Chave secreta do gateway legível por qualquer cliente logado

A tela de Payment Options oferece um campo "Secret Key" que grava em
`payment_options.gateway_config`. A RLS dessa tabela é por LINHA, e a policy
`"Read visible payment_options"` libera SELECT para todo `authenticated` — ou seja,
qualquer cliente logado baixa a chave pelo console do navegador.

O checkout já não lê mais essa coluna (colunas explícitas), então **o vazamento
está fechado do lado do app**. O que continua aberto é a leitura direta.

E há um segundo problema: **nada no repositório lê `gateway_config`**. O admin
digita a chave, a tela diz que salvou, e o pagamento nunca usa aquilo.

**Decisão:** (1) o campo sai da tela até existir integração que o use, e a coluna é
zerada; ou (2) a coluna vira admin-only na RLS e o campo fica. Se for (2), me diga
e eu mando o SQL.

### B2. Apagar um funcionário apaga os pedidos dele

`pedidos.cliente_id` é `ON DELETE CASCADE`, e o pedido de um sub-login fica com o
`cliente_id` **do sub**. Apagar o funcionário leva os pedidos dele e todos os
`pedido_itens` — irreversível. O confirm diz apenas que remove o funcionário e o
login.

O mesmo delete sem contagem está em `Clientes.tsx`.

**Decisão:** contar antes de perguntar (como já faço em Produtos e Privacy Groups),
ou **bloquear** o delete quando houver pedido? A segunda é mais segura e é o que eu
recomendo — histórico de pedido não devia sumir por clique numa tela de cadastro.

### B3. Desmarcar "Private" apaga as liberações sem aviso

Em `ProductEdit`, desmarcar Private apaga `produto_acesso` e
`produto_cliente_acesso` do produto. Remarcar volta vazio, e a lista não existe em
lugar nenhum para recuperar.

**Decisão:** apagar é o comportamento desejado (e aí basta um confirm com
contagem), ou a lista deve sobreviver ao toggle?

### B4. Nome duplicado em três tabelas que decidem acesso e preço

Nenhuma tem `UNIQUE`: `privacy_groups.nome`, `tabelas_preco.nome`,
`product_statuses.nome`.

- **privacy_groups**: seis telas listam por nome; dois grupos homônimos viram dois
  checkboxes idênticos num controle que decide **quem vê qual produto**.
- **tabelas_preco**: o sync do B2BWave casa por nome minúsculo em `Map` com
  last-write-wins — o preço vai para a régua errada, de forma indefinida entre
  execuções.
- **product_statuses**: navegador (`Map`, última vence) e banco (`LIMIT 1` sem
  `ORDER BY`) podem decidir coisas opostas para o mesmo produto.

```sql
-- Ver duplicatas nas três:
SELECT 'privacy_groups' t, lower(btrim(nome)) n, count(*) FROM public.privacy_groups GROUP BY 1,2 HAVING count(*)>1
UNION ALL SELECT 'tabelas_preco', lower(btrim(nome)), count(*) FROM public.tabelas_preco GROUP BY 1,2 HAVING count(*)>1
UNION ALL SELECT 'product_statuses', lower(btrim(nome)), count(*) FROM public.product_statuses GROUP BY 1,2 HAVING count(*)>1;
```

**Se voltar vazio:**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS privacy_groups_nome_uniq   ON public.privacy_groups   (lower(btrim(nome)));
CREATE UNIQUE INDEX IF NOT EXISTS tabelas_preco_nome_uniq    ON public.tabelas_preco    (lower(btrim(nome)));
CREATE UNIQUE INDEX IF NOT EXISTS product_statuses_nome_uniq ON public.product_statuses (lower(btrim(nome)));
```

**Ressalva:** `produtos.sku` deixou de ser UNIQUE de propósito, porque no B2BWave
real vários produtos compartilham código. Se qualquer uma das três acima também
aceita homônimo por decisão de produto, me diga e eu tiro da lista — e a correção
passa a ser mostrar algo discriminante nos seletores.

### B5. Status de produto é chave de sistema e não tem nada segurando

`produtos.status_produto` é `text` e o casamento com `product_statuses` é **por
nome**, sem FK. Os três consumidores — `lib/stock.ts`, o catálogo do portal e o
gatilho `fn_item_produto_valido` — **falham abrindo**: nome que não casa é tratado
como "pode comprar e pode aparecer".

Renomear ou apagar "Sold Out" devolve à vitrine, comprável, todo produto que você
tirou de venda de propósito com estoque em caixa.

A tela agora **avisa** antes de renomear ou apagar um dos seis de fábrica. Isso é
guarda no chamador, não na causa.

**Decisão:** (1) trigger no banco que recusa UPDATE de `nome` e DELETE nas seis
linhas de sistema, ou (2) trocar `produtos.status_produto` de texto livre para FK
em `product_statuses.id`, migrando os valores em português? A (2) mata a classe
inteira, mas mexe em `produtos`, no sync do B2BWave e nos três consumidores.

### B6. Categoria pode virar ciclo

As CTEs de RLS que sobem a árvore de `categorias` usam `UNION ALL` **sem detecção
de ciclo**. Um `parent_id` circular (A→B→A) trava a consulta.

Não achei caminho na UI que crie isso hoje, mas a coluna aceita.

**Decisão:** quer o trigger anti-ciclo? É pequeno e fecha de vez.

### B7. Export de manager e warehouse não deixa rastro

`export_logs` não tem policy de INSERT para esses dois papéis. Eles exportam e o
log não registra.

**Decisão:** acrescentar a policy, ou export é privilégio de admin e os outros dois
não deveriam exportar?

---

## C. Não bloqueia lançamento — promessa vazia na tela

Cada item aqui é um campo ou aba que o admin preenche e que **nada no sistema lê**.
Nenhum causa perda de dado; todos causam trabalho jogado fora e expectativa errada.

| O quê | Onde | Situação |
|---|---|---|
| **Botão Reject de cliente** | `CustomerEdit` | Grava `"rejeitado"` num enum de TRÊS valores (`ativo`/`inativo`/`pendente`). Falha **100% das vezes**, com erro cru do Postgres. |
| **Product Status Rules** | tela própria + aba do produto | A tabela é gravada e **nenhum trigger, função ou edge a lê**. A automação nunca existiu. |
| **Related / Bundled Products** | aba do `ProductEdit` | `produtos_relacionados` e `comprar_junto` não aparecem em nenhuma tela do portal. |
| **Estimated Availability Date** | `ProductEdit`, ao lado de "Pre-order" | `data_disponibilidade` não é lida por nenhuma tela, e-mail ou PDF. |
| **Aba Addresses** | `CustomerEdit` | Os campos usam `defaultValue` sem `onChange` e não há botão de salvar: **editar endereço nunca grava**. E "Add Address" cria uma linha em branco direto no banco. |
| **Valor de opção da variante** | `ProductEdit` | Variante criada no admin nasce com `valores_opcao: []` e não há UI para preencher — o cliente escolhe entre códigos crus em vez de "Size: Large". |
| **Terms & Privacy Policy** | `Configuracoes` | Gravados e **sem nenhum leitor**: nem rodapé, nem cadastro, nem checkout. |
| **Currency e Timezone** | 3 telas | `formatCurrency` é `en-US`/`USD` **fixo**, e toda data usa o fuso do navegador. Os campos só são ecoados pela edge `api`. |
| **Primary / Secondary Color** | 3 telas | Nenhuma variável CSS é derivada delas. Três telas para pintar dois quadradinhos de preview. |
| **Texto de SMTP** | `Configuracoes` | Manda configurar "abaixo" e clicar "Save SMTP Secrets" — o botão **não existe**, e a tela real de SMTP é outra (`settings/email`). |
| **Download do export** | `ExportsLog` | Removi a coluna: `arquivo_url` nunca é populada, porque o export é blob no navegador e não guarda arquivo. |
| **`tax_rates.estado` / `regiao`** | `SalesTax` | As colunas existem, a tela não mostra o campo, e o cálculo **ignora estado por completo** (a regra é por grupo). Hoje só servem para induzir ao erro do item A2. |
| **`/admin/configuracoes`** | — | Tela **órfã**: nenhum link no repositório inteiro. Duplica `Profile`, `EmailSettings` e `SetupApp` sobre a mesma linha da tabela. |

**Para cada linha, a pergunta é a mesma:** implementar, ou tirar da tela?

Minha recomendação, se quiser um caminho rápido: **tirar da tela** tudo que for
"C", exceto o **Reject** e a **aba Addresses**, que são funcionalidade esperada e
merecem ser implementadas. Tirar é reversível e para de mentir hoje.

---

## D. Permissão — precisa de você porque muda controle de acesso

### D1. Warehouse pode desativar produto e mudar status

A policy `"Warehouse update produtos"` é `FOR UPDATE` **sem restrição de coluna**,
então o warehouse grava `ativo` e `status_produto` à vontade. E `permissions.ts`
diz `edit_products: false` — o comentário ao lado afirmava que "o banco impõe o
mesmo", o que era falso. (Já corrigi o comentário.)

Desativar um produto o remove do portal para todos os clientes.

**Decisão:** warehouse pode mudar `status_produto`? (Ele já tem
`change_order_status`, e "Sold Out"/"Limited Stock" é vocabulário de logística.) Ou
fica só com `estoque_total`? A segunda exige `REVOKE UPDATE (coluna)` ou policy por
coluna — **eu não mexo em RLS sem você**.

### D2. Warehouse alcança as fichas de cliente e de produto

As rotas exigem só `view_customers` / `view_products`, que o warehouse tem, e as
telas **não checam papel no render**. No banco ele só tem SELECT, então os botões
aparecem e as escritas não acontecem.

Já fiz a metade que é código: as escritas agora **confirmam a linha** e avisam
quando nada foi gravado. O que falta é decidir se ele deveria estar naquelas telas.

**Decisão:** esconder os controles de quem não tem `edit_*`, ou tirar
`view_customers` do warehouse?

---

## E. Duas coisas que eu quero registrar

1. **Um mutante de teste entrou no histórico por um `git add -A` meu**, enquanto um
   agente plantava mutantes para medir as guardas. Ficou um commit no repositório
   com a guarda de zero linhas do `CustomerEdit` removida. Já restaurado
   (`fc6316f`). De agora em diante commito por caminho explícito.

2. **A mensagem do commit `3a09338` diz 682 testes; eram 681.**

---

## A5. As três réguas de preço duplicadas (achado de 30/ago, PARCIALMENTE resolvido)

O índice único de `tabelas_preco.nome` não pôde entrar: havia **três nomes
duplicados**, somando sete réguas.

| Nome | Régua | Clientes | Itens (antes) |
|---|---|---|---|
| Contractor's Price | `99a1286d` | **22** | 321 |
| Contractor's Price | `fe3ffa94` | 0 | 330 |
| Retail | `cfe462c7` | **9** | 321 |
| Retail | `f96c87c3` | **3** | 330 |
| `Wholesale Price ` (espaço no fim) | `b5337cf5` | **34** | 317 |
| `Wholesale Price ` (espaço no fim) | `1ec16984` | 0 | 326 |
| `Wholesale Price` | `47c1aa7b` | 0 | 0 |

### Como isso aconteceu

O sync do B2BWave casa régua por `pl.nome.toLowerCase()` — **sem `trim`**
(`b2bwave-sync/index.ts:1138` e `:1819`). Duas réguas têm espaço no fim do nome,
então `"wholesale price "` e `"wholesale price"` são chaves DIFERENTES para o sync,
e ele inseriu uma cópia em vez de reconhecer a existente.

E o mapa de preços é *last-wins* sobre um `select` **sem `order`**: com duas réguas
na mesma chave, o preço vai para uma delas de forma indefinida entre execuções. É a
assinatura do 321-vs-330 — uma foi alimentada por um tempo, a ordem de leitura
virou, e a outra passou a receber.

### O que foi verificado

- **Divergência de preço entre as cópias: ZERO.** Todo produto presente nas duas
  tem o mesmo valor. Nenhum cliente pagou errado.
- A cópia menor era **subconjunto** da maior: faltavam 9 produtos em cada par, e os
  clientes estavam justamente na menor. Para esses 9 produtos eles caíam em
  `produtos.preco` — o preço de balcão, mais caro.

### O que foi feito

`INSERT` aditivo copiando os 27 itens faltantes (9 × 3) para as réguas onde os
clientes estão. Nada apagado, nenhum preço alterado. Confirmado depois: 330 / 330 /
326 nas três réguas com cliente.

### O que continua pendente — decisão da Jessika

1. **Qual régua de cada par sobrevive**, e o que fazer com a outra. Apagar muda o
   preço de gente real (`clientes.tabela_preco_id` é `ON DELETE SET NULL`, então
   quem apontava para a apagada cai no preço de balcão).
2. **`Wholesale Price` sem espaço (`47c1aa7b`)**: 0 clientes, 0 itens. Parece lixo,
   mas não apago sem confirmação.
3. **Os nomes com espaço no fim** precisam ser aparados de qualquer jeito — a tela
   já apara desde 30/ago, mas as linhas existentes não foram tocadas.

Só depois disso o índice único pode entrar:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS tabelas_preco_nome_uniq
  ON public.tabelas_preco (lower(btrim(nome)));
```

**Conserto de raiz, independente da decisão acima:** o sync deveria casar por
`btrim(lower(nome))` e ordenar a leitura, senão a duplicata volta a nascer sozinha.
Isso é código de edge function — preciso do seu OK para mexer, e o deploy tem que
ser pedido no chat do Lovable.
