# REVIEW — Parte 0: Fundação & Segurança base

**Data:** 2026-06-17
**Escopo:** `App.tsx` (rotas/guards), `ProtectedRoute`, `AuthContext`, client Supabase, função `has_role`, migration fundadora de RLS e varredura de policies abertas a `anon`.
**Método:** revisão estática de código + migrations.

---

## Resumo da arquitetura de segurança (a "lente" para o resto)

- **Gating de rota é 100% client-side e burlável.** `ProtectedRoute` (`src/components/ProtectedRoute.tsx`) e `AuthContext` só controlam o que a UI mostra. Papel (`role`), modo demo (`isDemo`) e impersonação (`viewAsCustomer`) vivem em `localStorage`/`sessionStorage` e podem ser editados pelo usuário. **Isso é aceitável SE — e somente se — a RLS do banco segurar.** Toda a segurança real depende da RLS do Supabase.
- **A RLS central das tabelas principais está correta** (migration `20260317043654`):
  - `has_role()` é `SECURITY DEFINER` + `STABLE` + `SET search_path = public` → padrão correto, evita recursão de RLS. ✅
  - `clientes`, `pedidos`, `pedido_itens`, `enderecos` têm policies escopadas por dono (`auth.uid() = user_id`, direto ou via join em `clientes`). Para o papel **`authenticated`**, um cliente NÃO lê pedido de outro cliente. ✅
  - `user_roles`: usuário só lê o próprio papel; só admin gerencia. **Não há escalonamento de privilégio** por self-insert. ✅

> Conclusão da lente: o modelo é "RLS é tudo". Onde a RLS estiver certa, o front burlável não importa. Onde a RLS vazar, vaza para a internet inteira (a anon key é pública, está no bundle JS).

---

## ACHADOS

| # | Severidade | Achado | Arquivo |
|---|-----------|--------|---------|
| 0-1 | 🔴 **CRÍTICO** | `anon` (chave pública) pode ler TODOS `clientes`, `pedidos`, `pedido_itens` e tabelas de preço | migration `20260318201817` |
| 0-2 | 🟠 Médio | "Backdoor" de demo: digitar `admin`/`user` no login vira admin/cliente (sem senha) | `AuthContext.loginAsDemo` + telas de login |
| 0-3 | 🟡 Baixo | Impersonação (`viewAsCustomer`) gravável direto em localStorage | `AuthContext.applyViewAsSession` |
| 0-4 | 🟡 Baixo/Func. | Papéis `manager`/`warehouse` passam no guard `<S>` mas a maioria das RLS só aceita `admin` | `App.tsx` + migrations |
| 0-5 | ⚪ Info | `Login.tsx` é código morto (importado, não roteado) | `src/pages/Login.tsx` |
| 0-6 | ⚪ Info | Casts `(supabase as any)` mascaram tipos em auth | `AuthContext.tsx:81` |

---

## 🔴 0-1 — CRÍTICO: vazamento total de clientes e pedidos para `anon`

**Arquivo:** `supabase/migrations/20260318201817_794cfce8-74fe-49d6-8a1b-42794ac3e1db.sql`

```sql
-- Allow anon (demo mode) to read key tables
CREATE POLICY "Anon can read pedidos"       ON public.pedidos        FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read pedido_itens"  ON public.pedido_itens   FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read clientes"      ON public.clientes       FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read tabelas_preco" ON public.tabelas_preco  FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read tabela_preco_itens" ON public.tabela_preco_itens FOR SELECT TO anon USING (true);
-- (+ produtos, categorias, brands, representantes, banners, noticias)
```

**Por que é crítico.** O papel `anon` corresponde à **chave pública** (`VITE_SUPABASE_PUBLISHABLE_KEY`), que é embutida no bundle JS publicado — qualquer um lê. Políticas RLS são combinadas por **OR**, então uma policy `TO anon USING (true)` libera leitura **incondicional** dessas tabelas para o mundo, anulando as policies escopadas por dono. Nenhuma migration posterior dá `DROP`/`REVOKE` nessas policies — **estão ativas**.

**Dados expostos (via REST API com a anon key, sem login):**
- `clientes` → nome, empresa, **email, telefone**, status de todos os clientes (PII).
- `pedidos` → todos os pedidos: total, status, datas, `cliente_id`.
- `pedido_itens` → todos os itens: produto, **quantidade, preço unitário**.
- `tabelas_preco` / `tabela_preco_itens` → sua **tabela de preços B2B por tier** (preço diferenciado por cliente).

**Como reproduzir (sem nenhuma conta):**
```bash
ANON="<copiar do bundle JS publicado>"
curl 'https://bnicfvxvyblzzatvursw.supabase.co/rest/v1/clientes?select=*' \
     -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
# → dump de TODOS os clientes. Idem para /pedidos e /pedido_itens.
```

> Observação: um cliente **logado** usa o papel `authenticated` (não `anon`), então pela UI logada ele continua sem ver pedido de outro cliente. O vazamento é via **anon key crua** — atinge o mundo inteiro, é pior que "cliente vê cliente".

**Origem:** feito para o "modo demo" (que roda sem JWT → consultas como `anon`) conseguir mostrar dados. Mas demo jamais deveria expor clientes/pedidos reais.

**Correção recomendada (nova migration):**
```sql
DROP POLICY IF EXISTS "Anon can read pedidos"            ON public.pedidos;
DROP POLICY IF EXISTS "Anon can read pedido_itens"       ON public.pedido_itens;
DROP POLICY IF EXISTS "Anon can read clientes"           ON public.clientes;
DROP POLICY IF EXISTS "Anon can read tabelas_preco"      ON public.tabelas_preco;
DROP POLICY IF EXISTS "Anon can read tabela_preco_itens" ON public.tabela_preco_itens;
```
- `produtos`/`categorias`/`brands`/`banners`/`noticias` anon: avaliar na Parte 2/6. Numa loja B2B fechada, talvez também não queira catálogo/preço público — mas **clientes/pedidos/preços é o que precisa cair já**.
- O modo demo precisa ser repensado para usar dados fake/seed, não dados de produção.

---

## 🟠 0-2 — Backdoor de demo (login sem senha)

`AuthContext.loginAsDemo` concede `role` no front. As telas de login chamam isso quando o email é `admin` ou `user`:
```ts
if (emailLower === "admin") { loginAsDemo("admin"); navigate("/admin"); }
```
Encontrado em `Login.tsx` (morto) — **falta confirmar `CustomerLogin.tsx` e `AdminLogin.tsx` na Parte 1.** Impacto real é limitado pela RLS (demo = `anon`, sem JWT → só vê o que o achado 0-1 expõe), mas é superfície de risco e UX confusa em produção. Recomendo remover o atalho demo do build de produção.

## 🟡 0-3 — Impersonação gravável em localStorage
`applyViewAsSession` confia em `localStorage.viewAsCustomer` e seta `user.id = customer.user_id` no front. Qualquer um pode forjar o objeto. **Mitigado pela RLS**: o client Supabase continua usando o JWT real (ou nenhum), então no banco o usuário só acessa o que o JWT permite. Sem o achado 0-1, isso é inofensivo. Caminho legítimo (`/view-as?token=`) usa RPC `consume_view_as_token` (criação exige admin) — ok.

## 🟡 0-4 — `manager`/`warehouse` vs RLS só-admin (carregar p/ Parte 7)
O enum `app_role` ganhou `warehouse` e `manager` depois. Os guards `<S>` (staff) deixam esses papéis entrarem em várias telas admin, mas a maioria das policies só checa `has_role(...,'admin')`. Provável efeito: staff não-admin entra na tela mas o banco bloqueia as escritas (falha "fail-closed", segura, porém vira bug funcional / botões que não entregam). Verificar cobertura de policies para esses papéis na Parte 7.

## ⚪ 0-5 / 0-6 — Informativos
- `Login.tsx`: importado em `App.tsx` mas sem `<Route>` → código morto. Limpar.
- `AuthContext.tsx:81` usa `(supabase as any)` — perda de tipagem; baixo impacto.

---

## Perguntas abertas levadas para a Parte 7 (Backend/RLS)
1. **TODAS** as tabelas têm RLS habilitada? (notification_*, company_contacts, coupons, configuracoes, oauth, api keys, activity_logs…). Varredura completa de `pg_policies`.
2. Cobertura de policies para `manager`/`warehouse`.
3. `company_contacts` (sub-login): a RLS de `pedidos` usa `clientes.user_id = auth.uid()`, mas o contato tem `auth.uid()` próprio ≠ dono da empresa → ele consegue (ou não) ver os pedidos da empresa? Há policy específica?
4. Edge functions com `service_role` (admin-create-user, api, stripe-checkout, notify-dispatch): validam auth antes de agir?
5. Outras tabelas com `anon USING(true)` sensível (ex.: `configuracoes` tem leitura `authenticated USING(true)` — contém secrets? checar).

---

## Veredito da Parte 0
Fundação **conceitualmente correta** (RLS por dono + `has_role` SECURITY DEFINER), mas comprometida por **1 falha CRÍTICA real e ativa** (0-1) que expõe clientes, pedidos e preços à internet via a chave pública. **Recomendo corrigir 0-1 antes de qualquer publicação.** Demais achados são de baixo/médio impacto enquanto 0-1 existir como prioridade.
