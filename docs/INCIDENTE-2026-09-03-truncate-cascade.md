# Incidente 03/set/2026 — `TRUNCATE ... CASCADE` apagou os clientes

**Causa: eu (Claude).** Escrevi e entreguei o comando. O dono executou o que eu
mandei.

## O comando

```sql
BEGIN;
TRUNCATE public.tabela_preco_itens, public.tabelas_preco RESTART IDENTITY;  -- o que eu QUERIA
TRUNCATE public.tabela_preco_itens, public.tabelas_preco CASCADE;           -- o que eu MANDEI
COMMIT;
```

## Por que destruiu

`DELETE ... CASCADE` e `TRUNCATE ... CASCADE` **não são a mesma coisa**, e é aqui
que eu errei:

| | comportamento |
|---|---|
| `DELETE` numa linha | honra a ação da FK — `ON DELETE SET NULL` anula a coluna e **preserva a linha filha** |
| `TRUNCATE ... CASCADE` | **trunca toda tabela que referencia** a truncada. A ação da FK é **ignorada**. |

`clientes.tabela_preco_id` referencia `tabelas_preco` com `ON DELETE SET NULL`. Eu
raciocinei pelo `SET NULL` — que estava certo para `DELETE` e é irrelevante para
`TRUNCATE`. O `CASCADE` truncou `clientes`, e de `clientes` desceu para tudo que
depende dela.

**Eu sabia dessa diferença e usei o comando errado mesmo assim.** Não foi
desconhecimento, foi falta de cuidado num comando irreversível.

## O que foi perdido

| tabela | antes | depois |
|---|---|---|
| `clientes` | 70 | 0 |
| `enderecos` | ? | 0 |
| `auth.users` | 71 | 7 (só a equipe) |
| `pedidos` / `pedido_itens` | 0 | 0 *(já tinham sido zerados de propósito no mesmo dia)* |
| `tabelas_preco` / `tabela_preco_itens` | 7 / 1015 | 0 *(intencional — decisão da Jessika)* |

**Intactos:** `produtos` (330), `categorias` (48), `profiles` (7),
`producao_pedidos` (65), `sync_state` (16), `configuracoes` (1).

## Recuperação — o que funcionou

Não houve PITR: o agente do Lovable não expõe restore nem dump, e o suporte não
chegou a ser acionado.

**1. Inventário do que sobrou** — a chave foi descobrir que `notification_log`
(2.763 linhas) guarda `customer_email`, `customer_name`, `customer_company` e
`customer_phone` no `payload`, em 2.550 registros. Foi ele que provou quais
clientes existiam, e serviu de conferência no fim.

```sql
SELECT DISTINCT jsonb_object_keys(payload), count(*)
FROM public.notification_log GROUP BY 1 ORDER BY 2 DESC;
```

**2. Edge function de uso único** (`supabase/functions/recuperar-clientes/`), que
é o pedaço da `b2bwave-sync` que resolve o incidente e **só ele**: lê
`customers.json` e insere em `clientes`.

Restrições deliberadas, e o motivo de cada uma:

- **não toca pedido** — reimportar ~690 pedidos dispararia um gatilho de
  notificação por pedido, o vetor exato do incidente dos 1.508 SMS de 25/ago;
- **não manda e-mail nem SMS** — só `auth.admin.createUser` com
  `email_confirm: true` e senha aleatória; nunca `inviteUserByEmail`,
  `generateLink` ou `resetPasswordForEmail`;
- **não faz UPDATE nem DELETE** — só insere quem falta;
- **dry-run por padrão** — gravar exige `{"confirmar": true}` explícito;
- **sem cron.**

**3. `clientes.user_id` é NOT NULL.** A primeira tentativa falhou inteira nisso, e
foi bom: o lote 1 abortou sem gravar nada pela metade. A função passou a criar o
login antes de inserir.

## Resultado

```
lidos_no_b2bwave    66
logins_criados      64
logins_reaproveitados 2
inseridos           66
falhas              []
```

Conferido depois contra o `notification_log`: **os únicos e-mails que sobraram
fora do banco são cinco contas internas** — `admin@permshield.com`,
`jess@permwood.com`, `jessika.andrade@hotmail.com`, `clovisjunior@live.com`,
`clovisbarbosajr@gmail.com`. **Nenhum cliente real ficou faltando.**

Estado final: **66 clientes, 71 logins, 330 produtos, 48 categorias.**

## O que não voltou

- **Endereços** (`enderecos`) — não existem no B2BWave nem no log. Perdidos.
- **Senhas** — todos com senha aleatória. Entram por "esqueci minha senha", um de
  cada vez, quando o dono mandar. Ninguém foi notificado.
- **Tabelas de preço** e **pedidos** — apagados de propósito, não são perda.

## As regras que saem disso

1. **`TRUNCATE ... CASCADE` é proibido em tabela referenciada.** Se precisar
   esvaziar, use `DELETE FROM`, que honra a ação da FK. Se o volume exigir
   `TRUNCATE`, liste explicitamente as tabelas e **nunca** use `CASCADE`.
2. **Antes de qualquer comando destrutivo, listar quem depende:**
   ```sql
   SELECT c.conrelid::regclass AS tabela_dependente, c.conname, c.confdeltype
   FROM pg_constraint c
   WHERE c.contype='f' AND c.confrelid = 'public.<alvo>'::regclass;
   ```
   `confdeltype` = `n` é `SET NULL`, `c` é `CASCADE`, `a` é `NO ACTION`. E lembrar
   que **nada disso vale para `TRUNCATE CASCADE`**.
3. **Backup explícito antes**, na forma que este projeto já usava
   (`backup_tpi_20260826`, `backup_categorias_20260827`):
   `CREATE TABLE backup_x_AAAAMMDD AS SELECT * FROM x;`
4. **`notification_log` é o último recurso forense.** Ele guarda identidade de
   cliente no `payload` e sobreviveu ao TRUNCATE porque não referencia `clientes`.
   Não apagar.

## Pendente

- Pedir ao Lovable que **apague a `recuperar-clientes`** — ela reabre a porta do
  B2BWave, fechada de propósito no mesmo dia, e já cumpriu a função.
