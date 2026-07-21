# PDF da ordem, notificações e endereços — mudanças de 2026-07-21

Documento do batch de correções feito em 21/jul/2026 no PDF que vai anexado
aos emails de ordem, no campo "Company", nos endereços e nos gatilhos de
notificação (SMS). Serve de referência pra ENTENDER onde cada coisa mora e
por que — pra ser fácil de alterar no futuro.

---

## 1. Causa raiz: "Company" mostrava o nome da PESSOA (não a empresa)

**Sintoma:** no PDF/email da ordem, o campo aparecia como `Customer: jess`
(nome da pessoa) em vez da empresa (`Zap Supplies, LLC`), mesmo com a empresa
preenchida no cadastro do cliente.

**Causa (bug de código, não dado vazio):** o checkout montava o objeto de
notificação assim:
```js
const emailCustomer = { ..., nome: customerName, empresa: customerName };
```
e `customerName` = `cliente.nome` (a PESSOA). Ou seja, o checkout **sempre
mandava o nome da pessoa dentro do campo `empresa`**. No gerador do PDF, o
merge `{ ...cli, ...customer }` deixava esse valor errado **sobrescrever** o
`empresa` correto que vinha do banco.

**Correção (commit `1ff708b`):**
- `src/pages/portal/Checkout.tsx`: novo estado `customerCompany = cliente.empresa`;
  as duas construções de `emailCustomer` passam `empresa: customerCompany`
  (empresa real) e `nome: customerName` (pessoa) SEPARADOS.
- `supabase/functions/send-email/index.ts` (`buildOrderPdf`): merge invertido
  para `{ ...customer, ...cli }` — o **banco passa a ser AUTORITATIVO** para
  `empresa`/`nome`/endereço; só o `email` do caller mantém prioridade. Isso
  protege também os fluxos de admin e de mudança de status.

**Onde isso se reflete:** campo Company do PDF, corpo do email e assunto.

---

## 2. Rótulo "Customer" → "Company"

**Commit `5ff7db7`.** Nos dois geradores (`send-email` e `generate-pdf`), o
campo da esquerda passou de `field("Customer", ...)` para `field("Company", ...)`.
O valor é `cust.empresa || cust.nome`; a pessoa aparece em `Contact` quando
`empresa` e `nome` diferem.

---

## 3. Endereços organizados por linha (rua / cidade, estado / zip)

**Commit `5a3bb5c`.** Antes o endereço era uma string única quebrada por
LARGURA (cortava no meio: `...POMPANO BEACH,` / `FL`). Agora quebra por LINHA
SEMÂNTICA.

- **Customer address (esquerda):** montado em `buildOrderPdf` a partir dos
  campos estruturados do endereço de entrega/cadastro, em 3 linhas:
  `rua+complemento` / `cidade, estado` / `zip`, juntadas com `\n`.
- **Company address (direita):** o texto livre de `configuracoes.endereco`
  passa pelo helper **`_fmtStoreAddress`** (commit `d74e7ba`), que interpreta o
  formato US "rua, cidade, ST ZIP" e monta 3 linhas: `rua` / `cidade, estado` /
  `zip` — batendo com o bloco do cliente. Robusto: sem zip → 2 linhas; sem
  vírgula → 1 linha; suporta ZIP+4. (Antes era um `split(/[\n,]/)` ingênuo que
  quebrava em TODA vírgula, separando "Pompano Beach" de "FL".)
- **Gerador:** `field()` e o bloco da empresa agora respeitam `\n` (quebra
  semântica) e só aplicam wrap por largura como fallback dentro de cada linha.
  Helpers `cleanSeg`/`cleanAddr` preservam o `\n`. Replicado em `send-email` e
  `generate-pdf`.

**Como preencher o endereço da empresa:** em Settings → Profile → aba
**Address**, pode digitar no formato natural US, ex.:
`1800 N Powerline Rd #5, Pompano Beach, FL 33069`. O `_fmtStoreAddress` separa
sozinho em rua / cidade, estado / zip. **Onde alterar o formato:** a função
`_fmtStoreAddress` no topo de `send-email/index.ts` e `generate-pdf/index.ts`
(as duas cópias precisam ficar iguais).

---

## 4. Carimbo de versão no rodapé do PDF (diagnóstico de deploy)

**Commits `6f992ad` (0721b) e `5ff7db7` (0721c).** O rodapé do PDF mostra um
marcador (`layout 0721c`) no canto inferior direito. Serve pra saber se o
deploy pegou o código novo: se o PDF do email NOVO mostra o carimbo, o deploy
aplicou; se não mostra, o `send-email` está rodando código velho (deploy
stale). Remover depois de confirmado que o fluxo de deploy é confiável.

---

## 5. Removido o card de preview de PDF da página

**Commit `6f992ad`.** O card "Order PDF (attached to the email)" em
`src/pages/admin/settings/Notificacoes.tsx` (com botão Preview) foi removido,
junto com a função `handlePdfPreview` e o estado `pdfPreviewing`. Motivo: o
preview da página confundia com o PDF real do email. O PDF do email é gerado
por código (não é editável por HTML).

---

## 6. Gatilhos de notificação por SMS (SQL no banco)

Dois triggers no banco (rodados direto pelo runner de SQL do Lovable — ver
seção 8). Migrations:
- `supabase/migrations/20260718120000_low_stock_trigger.sql` — `fn_low_stock_notify`
  + `trg_low_stock_notify` em `produtos`. Dispara `low_stock` (notify-dispatch)
  quando o estoque disponível CRUZA o limite (acima→abaixo). Dedup natural: só
  na transição, não repete enquanto continua abaixo.
- `supabase/migrations/20260720120000_order_status_notify.sql` — `fn_order_status_notify`
  + `trg_order_status_notify` em `pedidos`. Dispara `order_status` em qualquer
  mudança real de status. Padrão do low_stock (confiável, independe de
  sessão/deploy do frontend).

Ambos assíncronos (`net.http_post` enfileira) e à prova de falha (`EXCEPTION`):
uma falha de notificação NUNCA derruba o update. Dependem de: extensão `pg_net`
e segredos `PROJECT_ANON_KEY` / `CRON_SECRET` no Vault.

---

## 7. Endereço da empresa (bloco direito) vinha vazio — RESOLVIDO

**Sintoma (era):** o endereço no bloco da direita do PDF não aparecia.

**Causa real:** o campo `configuracoes.endereco` estava simplesmente VAZIO. O
dono preencheu em Settings → Profile → aba **Address**, salvou, e o valor
PERSISTIU (recarregou e continuou lá). Ou seja: não era bug de renderização nem
de múltiplas linhas — era só o campo não preenchido. Com o campo preenchido +
o parser `_fmtStoreAddress`, o endereço aparece no bloco direito em 3 linhas.

**Fragilidade a consolidar no futuro (não bloqueante):** o endereço da empresa
está espalhado em DUAS fontes — `configuracoes.endereco` (texto livre, usado
pelo PDF e editado no Profile) e as colunas estruturadas `company_address/
company_city/company_state/company_zip` (usadas pelo template HTML do email,
mas SEM tela que as edite). Convém unificar numa fonte só. Além disso, todas as
leituras de `configuracoes` usam `.limit(1).maybeSingle()` sem `ORDER BY` — se
um dia existir mais de uma linha na tabela, é bom garantir linha única ou
ordenar.

---

## 8. Checkout lento pra carregar o endereço — SOLUÇÃO DEFINITIVA

**Sintoma:** ao abrir o checkout, o endereço demorava pra aparecer (a lentidão
"voltou" depois de já ter sido mexida antes).

**Causa raiz (commit `d74e7ba`):** o `useEffect` que faz TODAS as buscas de
rede do checkout (cliente, endereços, conta-pai, frete, pagamento, cascata de
imposto, config do Stripe) tinha **`total`** no array de dependências:
```js
}, [user, impersonatedCustomer, total]);
```
Como `total` muda a cada alteração do carrinho, a **busca inteira re-executava
toda vez** — inclusive o endereço, que não depende do total. O `total` só
estava ali por causa do cálculo do imposto (`salesTax = total * taxRate/100`).

**Por que a correção é segura:** já existe um efeito derivado separado que
recalcula só o VALOR do imposto quando o carrinho muda:
```js
useEffect(() => { setSalesTax((total - discount) * taxRate / 100); },
         [total, discount, taxRate]);
```
Ou seja, a taxa é buscada 1x; o valor do imposto reage sozinho. Então `total`
era 100% redundante nas deps da busca.

**Correção:**
- `src/pages/portal/Checkout.tsx`: removido `total` das deps do efeito de busca
  → passa a rodar 1x (por `[user, impersonatedCustomer]`).
- Removidos os `setSalesTax(total * pct / 100)` de dentro da busca (o efeito
  derivado já cuida do valor).

**Onde mexer no futuro:** se adicionar mais buscas no checkout, mantê-las nesse
efeito de `[user, impersonatedCustomer]` (roda 1x). Qualquer coisa que dependa
do `total` deve ser um CÁLCULO derivado num efeito próprio, nunca uma busca.

---

## 9. Nota de infraestrutura

O Supabase deste projeto é do **Lovable Cloud** (ref `bnicfvxvyblzzatvursw`) e
**não abre pelo dashboard do supabase.com**. SQL sempre pelo runner de SQL do
Lovable; deploy de código (frontend + edge functions) também pelo Lovable.
Ordem padrão: 1º SQL, 2º publish.

---

## Commits desta rodada
- `6f992ad` — carimbo 0721b + remove card de preview de PDF
- `5ff7db7` — rótulo "Customer" → "Company" + carimbo 0721c
- `1ff708b` — CAUSA RAIZ: checkout mandava `empresa` = nome da pessoa
- `5a3bb5c` — endereço organizado em linhas (rua / cidade, estado / zip)
- `d74e7ba` — perf checkout (endereço carrega 1x) + `_fmtStoreAddress`
  (endereço da empresa em 3 linhas a partir de texto livre US)

---

## Guia rápido: "onde mexer" (pra alterar fácil no futuro)

| Quero mudar... | Arquivo(s) |
|---|---|
| Layout/campos do PDF da ordem | `generateOrderPdf` em `supabase/functions/send-email/index.ts` (e a cópia em `generate-pdf/index.ts` — manter iguais) |
| Formato do endereço da empresa | `_fmtStoreAddress` (topo dos dois arquivos acima) |
| Rótulos (Company/Contact/Address...) | as chamadas `field("...", ...)` no gerador |
| Carimbo de versão | `rightText("layout 0721c", ...)` no rodapé do gerador |
| Textos/templates dos emails | funções `template*` em `send-email/index.ts` + aba Notifications (tabela `email_templates`) |
| Dados da empresa (nome, endereço, email) | Settings → Profile (`configuracoes`: `nome_empresa`, `endereco`, `email_contato`) |
| Empresa/contato do cliente | cadastro do cliente (`clientes.empresa` = Company, `clientes.nome` = Full Name) |
| Buscas do checkout | `useEffect` `[user, impersonatedCustomer]` em `Checkout.tsx` (roda 1x) |
| Gatilhos de SMS | migrations `*_low_stock_trigger.sql` e `*_order_status_notify.sql` |

**Regra de ouro dos dois geradores de PDF:** `send-email/index.ts` e
`generate-pdf/index.ts` têm o MESMO gerador inline (proposital — evita
depender de `_shared/`, que o Lovable às vezes não re-bundla). Qualquer
mudança no PDF precisa ser feita nos DOIS.
