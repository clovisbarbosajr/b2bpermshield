# REVIEW — Parte 1: Autenticação & Cadastro

**Data:** 2026-06-17
**Escopo:** `LoginLanding`, `AdminLogin`, `CustomerLogin`, `Cadastro`, `RecuperarSenha`, `ResetPassword`, `PendingApproval`, `ForgotPasswordModal`, `MagicLinkModal`. Fluxo cadastro → email → aprovação → notificação.
**Método:** revisão estática.

---

## Veredito rápido
**Nenhum botão falso e nenhum achado crítico nesta parte.** Os botões estão todos ligados a ações reais, e os fluxos de cadastro/reset **entregam** (a função `send-email` implementa `password_reset`, `waiting_approval`, `new_registration_admin`). Os achados são de baixa severidade: duplicação de fluxo de reset, página órfã, e uma lacuna de "esqueci a senha" no admin.

---

## ACHADOS

| # | Severidade | Achado |
|---|-----------|--------|
| 1-1 | 🟡 Baixo | Dois fluxos de reset de senha paralelos e inconsistentes |
| 1-2 | ⚪ Info | `/recuperar-senha` é página órfã (só linkada pelo `Login.tsx` morto) |
| 1-3 | 🟡 Baixo | `AdminLogin` não tem opção "Esqueci a senha" |
| 1-4 | 🟡 Baixo | Política de senha fraca (mínimo 6 caracteres) |
| 1-5 | ⚪ Info | `CustomerLogin` redireciona sempre p/ `/portal` (admin que loga aqui cai no portal) |

---

### 🟡 1-1 — Dois fluxos de reset de senha, comportamento divergente
- **Caminho ativo (bom):** `CustomerLogin` → `ForgotPasswordModal` → função `send-email` (SMTP próprio, tipo `password_reset` via `admin.generateLink`). Mensagem **genérica** ("If an account exists…") → protege contra enumeração de usuário. ✅
- **Caminho órfão (pior):** página `RecuperarSenha` (`/recuperar-senha`) usa `supabase.auth.resetPasswordForEmail` direto + mostra `toast.error(error.message)` → **pode vazar enumeração** (comportamento diferente p/ email existente vs inexistente) e usa o email padrão do Supabase em vez do SMTP da marca.
- **Recomendação:** remover a página `RecuperarSenha` (e o `Login.tsx` morto que a linka) OU alinhar a mensagem dela ao padrão genérico. Consolidar tudo no modal + `send-email`.

### ⚪ 1-2 — `/recuperar-senha` é órfã
Só há link para ela em `src/pages/Login.tsx` (que não está roteado — ver achado 0-5). Acessível apenas digitando a URL. Candidata a remoção junto com `Login.tsx`.

### 🟡 1-3 — `AdminLogin` sem "Esqueci a senha"
`src/pages/AdminLogin.tsx` não oferece recuperação de senha. Um admin que esquece a senha não tem caminho pela UI (teria que digitar `/recuperar-senha` na mão ou resetar pelo Supabase). Recomendo adicionar o `ForgotPasswordModal` (ou link) também no admin.

### 🟡 1-4 — Senha fraca
`Cadastro.tsx` e `ResetPassword.tsx` exigem só `length >= 6`. Aceitável p/ MVP, mas recomendo subir o mínimo e/ou exigir complexidade para uma plataforma B2B.

### ⚪ 1-5 — Redirect pós-login do cliente
`CustomerLogin.handleLogin` faz `navigate("/portal")` sem checar papel. Um admin que use o formulário de cliente cai em `/portal` (cosmético; a RLS continua valendo). `AdminLogin`, por outro lado, valida o papel server-side e desloga quem não é staff. ✅

---

## Pontos confirmados como OK (entregam)
- **Sem backdoor demo nas telas reais.** O atalho `admin`/`user` só existe no `Login.tsx` morto. `AdminLogin`/`CustomerLogin` fazem `signInWithPassword` real.
- **`AdminLogin` valida papel** (`admin`/`warehouse`/`manager`) consultando `user_roles` e desloga não-staff. ✅
- **Anti-enumeração** no `ForgotPasswordModal` e `MagicLinkModal` (mensagens genéricas). ✅
- **Fluxo de cadastro entrega:** cria auth user, dispara email de boas-vindas (`waiting_approval`), notifica admin (`new_registration_admin`) e dispara `notify-dispatch` `new_customer`. A criação do registro em `clientes` (status `pendente`) ocorre no 1º login via `ensureClienteRecord`.
- **`PendingApproval`** lê `clientes.status`/`is_active` e mostra estado correto (pendente/rejeitado/bloqueado). Sign out funciona.
- **`ResetPassword`** trata `PASSWORD_RECOVERY` e atualiza a senha; desloga e manda p/ login. Funcional.

---

## Levado para a Parte 7 (Backend)
- Confirmar que `send-email` realmente envia (SMTP Office365 configurado) — se falhar, "forgot password" e emails de cadastro viram no-op silencioso (parecem funcionar mas não chegam). O código trata os tipos corretos; falta validar config/entrega.
- `send-email` em `password_reset` loga "user not found" mas deve retornar sucesso genérico — verificar que não vaza enumeração via status/erro.

## Veredito
Parte de autenticação **sólida e funcional**. Limpeza recomendada (remover `Login.tsx` + `RecuperarSenha` órfãos, unificar reset) e 2 melhorias de robustez (forgot-password no admin, senha mais forte). Sem bloqueadores.
