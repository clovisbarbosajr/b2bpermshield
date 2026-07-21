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
- **Company address (direita):** o texto livre de `configuracoes.endereco` é
  dividido por vírgula/quebra (`split(/[\n,]/)`), um segmento por linha.
- **Gerador:** `field()` e o bloco da empresa agora respeitam `\n` (quebra
  semântica) e só aplicam wrap por largura como fallback dentro de cada linha.
  Helpers `cleanSeg`/`cleanAddr` preservam o `\n`. Replicado em `send-email` e
  `generate-pdf`.

**Como preencher o endereço da empresa pra sair organizado:** em
Settings → Profile → aba **Address**, digite separado por VÍRGULA, ex.:
`1800 N Powerline Rd Ste A6, Pompano Beach FL, 33069` → vira 3 linhas.

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

## 7. PENDENTE / EM INVESTIGAÇÃO: endereço da empresa (bloco direito) vem vazio

**Sintoma:** o endereço no bloco da direita do PDF não aparece.

**Entendimento (21/jul):** o bloco direito lê `configuracoes.endereco`. O PDF
mostra "PermShield" (= `config.nome_empresa`), que vem da MESMA query que
também traz `endereco`. Logo, a query funcionou e o `endereco` foi buscado —
**está VAZIO na linha que o `send-email` leu.** Não é bug de renderização.

**Duas causas possíveis:**
1. O campo nunca foi preenchido/salvo em Settings → Profile → aba Address.
2. **Múltiplas linhas em `configuracoes` + `.limit(1)` sem `ORDER BY`** — salva
   numa linha, lê de outra. TODAS as leituras de `configuracoes` no sistema
   usam `.limit(1).maybeSingle()` sem ordenação (Profile, send-email,
   EmailSettings, OrderDetail, Notificacoes, Configuracoes...), o que é frágil
   se existir mais de uma linha.

**Teste pra distinguir:** preencher o Address em Settings → Profile, salvar,
RECARREGAR a página. Se o valor não persiste → múltiplas linhas. Se persiste
mas o PDF continua vazio → send-email lê outra linha.

**Fragilidade adicional a consolidar:** o endereço da empresa está espalhado em
DUAS fontes — `configuracoes.endereco` (texto livre, usado pelo PDF e editado
no Profile) e as colunas estruturadas `company_address/company_city/
company_state/company_zip` (usadas pelo template HTML do email, mas SEM tela
que as edite). Convém unificar numa fonte só e adicionar `ORDER BY` (ou
garantir linha única) nas leituras de `configuracoes`.

---

## 8. Nota de infraestrutura

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
