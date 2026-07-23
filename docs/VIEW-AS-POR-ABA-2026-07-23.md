# "View as" isolado por aba + correções da rodada — 2026-07-23

Documento da rodada de 23/jul/2026: o bug do "View as" que contaminava todas
as abas, a regra de negócio admin-only, os testes executados e dois bugs
extras encontrados na varredura (imposto do carrinho e warning do login).
Serve de referência pra ENTENDER onde cada coisa mora — pra ser fácil de
alterar no futuro.

---

## 1. O bug: "View as" mudava TODAS as abas do navegador

**Sintoma:** a admin clicava em "View as" num cliente e **todas** as abas
abertas do navegador viravam a visão daquele cliente — não só a aba nova.

**Causa:** a impersonação era gravada no **`localStorage`**, que é
**compartilhado entre todas as abas** do mesmo site. Qualquer aba que lesse a
chave `viewAsCustomer` assumia a visão do cliente.

**Regra correta (dono):** só a aba do "View as" vira o cliente; as outras
continuam na sessão normal.

---

## 2. A solução: token de uso único + `sessionStorage` (por aba)

O `sessionStorage` é isolado **por aba** — essa é a base do fix. Fluxo novo:

```
[aba admin] botão "View as"
   → RPC create_view_as_token(customer_id)   (só admin — ver seção 3)
   → abre aba nova em /view-as?token=...
[aba nova] ViewAsRedirect
   → RPC consume_view_as_token(token)        (uso único, expira)
   → sessionStorage.viewAsCustomer = cliente (SÓ nesta aba)
   → redireciona pro /portal como o cliente
[outras abas] intocadas — sessão staff normal
```

**Arquivos:**
- `src/pages/admin/Clientes.tsx` → `handleViewAs` (~linha 175). Detalhe
  importante: a aba é aberta com `window.open("about:blank")` **ANTES** do
  `await` da RPC — abrir no gesto do clique evita o popup blocker; depois o
  token chega e a aba recebe a URL real.
- `src/pages/ViewAsRedirect.tsx` → rota pública `/view-as`. Consome o token e
  grava no `sessionStorage`. Sem token ou token inválido → `/login`.
- `src/contexts/AuthContext.tsx` → lê `sessionStorage` (não mais
  `localStorage`); faz higiene removendo resíduo antigo do `localStorage`; e
  tem a **guarda** (seção 3). `clearViewAs` (banner "Return to") limpa só a
  aba atual.
- `src/components/ViewAsBanner.tsx` → banner amarelo com "Return to"
  Dashboard/Orders/Customers; cada botão limpa o view-as DA ABA e navega.

**Efeitos colaterais corrigidos de graça:** fechar a aba mata a impersonação
(sessionStorage morre com a aba); resíduo antigo no localStorage não
sequestra mais login de cliente real.

---

## 3. Regra de negócio: "View as" é SÓ PRA ADMIN

Manager/warehouse **não** impersonam cliente. Três camadas alinhadas
(commit `46d6a2c`):

1. **Botão** (`Clientes.tsx`): `View as` só renderiza pra `role === "admin"`
   (via `useAuth()`; manager/warehouse nem veem o botão).
2. **Guarda** (`AuthContext.tsx`): a aba impersonada só é válida se a sessão
   REAL do navegador for de **admin** (`user_roles.role === 'admin'`). Senão,
   limpa a chave e expulsa pra `/`.
3. **Banco** (RPC `create_view_as_token`): exige `has_role(auth.uid(),'admin')`.

> Histórico: a migration `20260723120000_view_as_token_staff.sql` chegou a
> abrir a RPC pra manager/warehouse (interpretação errada minha — a tela de
> Customers é staff-wide). O dono corrigiu a regra e a migration
> **`20260723140000_view_as_token_admin_only.sql`** reverteu pra admin-only.
> As DUAS foram rodadas no banco; a vigente é a admin-only (mensagem de erro:
> "Only admins can create view-as tokens").

**Infra do token:** tabela `view_as_tokens` (token hex de 24 bytes,
`admin_user_id`, `customer_id`); `consume_view_as_token` é uso único com
expiração — token inválido/expirado é rejeitado.

---

## 4. Testes executados (ambiente local + backend real)

| # | Teste | Resultado |
|---|---|---|
| 1 | Resíduo antigo no `localStorage` → recarrega | ✅ removido, não sequestra |
| 2 | View-as forjado no `sessionStorage` SEM sessão admin | ✅ guarda limpa e expulsa pra `/` |
| 3 | `/view-as` sem token | ✅ → `/login`, nada gravado |
| 4 | `/view-as` com token forjado | ✅ RPC rejeita → `/login` |
| 5 | Isolamento: 2 abas, view-as plantado numa | ✅ a outra 100% limpa |
| 6 | RPC `create_view_as_token` sem autenticação | ✅ rejeitada pelo banco |

Não testado end-to-end (sem credencial de admin): o clique real no botão.
É a soma das partes acima. Teste manual: logada como admin com 2+ abas →
"View as" → aba nova vira o cliente, as outras continuam admin; como
manager, o botão nem aparece.

**Nota popup blocker (raro):** a aba abre no gesto do clique, então os
browsers permitem por padrão. Se uma extensão agressiva bloquear, o browser
mostra o ícone "pop-up bloqueado" na barra de endereço → "Sempre permitir".

---

## 5. Bugs extras encontrados na varredura

### 5.1 Imposto do Carrinho refazia 5 queries por clique (commit `47033c9`)
`src/pages/portal/Carrinho.tsx`: o efeito de imposto dependia de `total` e
refazia a cascata inteira (clientes → tax_classes → tax_customer_groups →
tax_rules → tax_rates) **a cada mudança de quantidade**. Mesma classe da
lentidão corrigida no Checkout (`d74e7ba`). Fix: a TAXA (%) é buscada 1x por
`[user, impersonatedCustomer]`; o VALOR é derivado localmente no efeito
`[total, taxRate]`.

**Regra pra manutenção:** busca de banco NUNCA depende de `total`. Tudo que
reage ao carrinho deve ser cálculo local derivado.

### 5.2 Warning React no login do cliente (commit `46e92bd`)
`src/pages/CustomerLogin.tsx`: React 18 não reconhece a prop camelCase
`fetchPriority` (só React 19+) — descartava a prop e logava warning a cada
render. Fix: atributo minúsculo via spread `{...{ fetchpriority: "high" }}`.
Verificado no DOM.

### 5.3 Verificado e OK (sem mudança)
- Nenhuma referência órfã a `total` na busca do Checkout.
- "View as" só tem UM ponto de entrada (botão em Customers).
- Merge do PDF (`{...customer, ...cli}`) seguro — consumidores usam `||`/`??`.
- Efeito de frete do Checkout depende de `total` mas é cálculo local (correto).
- Código morto no `generate-pdf` (templates HTML antigos não chamados) —
  inofensivo; limpeza fica pra depois.

---

## 6. Commits da rodada (2026-07-23)

- `f5f67c4` — view-as isolado POR ABA (token + sessionStorage + guarda)
- `46e92bd` — warning `fetchPriority` no CustomerLogin
- `46d6a2c` — view-as restrito a SÓ ADMIN (3 camadas) + migration reversora
- `47033c9` — perf: imposto do carrinho não refaz queries por clique

## 7. Estado de deploy (no momento deste doc)

- **SQL**: as duas migrations do view-as já RODADAS no Lovable (vigente:
  admin-only). Nada pendente de SQL.
- **Publish**: frontend até `47033c9` pendente de publish no Lovable.
  Nenhuma edge function mudou nesta rodada.
- Ordem padrão do projeto: 1º SQL, 2º publish.

## 8. Onde mexer (guia rápido)

| Quero mudar... | Onde |
|---|---|
| Quem pode usar "View as" | 3 lugares JUNTOS: botão em `Clientes.tsx` (`isAdmin`), guarda em `AuthContext.tsx`, RPC `create_view_as_token` (migration nova) |
| Destinos do banner "Return to" | `ViewAsBanner.tsx` |
| Validade/uso do token | RPCs `create_view_as_token` / `consume_view_as_token` (migrations `*_view_as_*`) |
| Comportamento pós-consumo (pra onde vai) | `ViewAsRedirect.tsx` (`window.location.replace("/portal")`) |
| Busca × cálculo no carrinho/checkout | taxa = busca 1x; valor = efeito derivado local (nunca busca por `total`) |

> **Nota de infra (sempre):** o Supabase é do Lovable Cloud — SQL pelo runner
> do Lovable, publish pelo Lovable. Não existe acesso pelo supabase.com.
