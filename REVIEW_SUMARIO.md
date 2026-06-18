# REVIEW — Sumário Executivo & Plano de Correção

**Data:** 2026-06-17 · **App:** b2bpermshield (Vite+React+Supabase) · **Método:** revisão estática completa, 8 partes.

Relatórios detalhados: [Parte 0](REVIEW_PARTE_0.md) · [1](REVIEW_PARTE_1.md) · [2](REVIEW_PARTE_2.md) · [3](REVIEW_PARTE_3.md) · [4](REVIEW_PARTE_4.md) · [5](REVIEW_PARTE_5.md) · [6](REVIEW_PARTE_6.md) · [7](REVIEW_PARTE_7.md)

---

## Quadro geral
O app é **grande e majoritariamente funcional** — o e-commerce (catálogo, carrinho, checkout com preço revalidado no servidor), o CRUD admin de produtos/clientes/pedidos, os 13 relatórios e os imports de CSV **entregam de verdade**. A parte de notificações funciona. **Mas há falhas de segurança graves** concentradas em RLS e edge functions, e um punhado de telas/botões falsos.

> **Resposta direta à sua preocupação ("mostrar compras de outro cliente / expor dados"):** dentro do app logado, cliente A **não** vê dados do cliente B (RLS owner-scoped). O vazamento real vem de **3 buracos**: a chave pública lê o banco todo (0-1), qualquer logado lê os segredos do sistema (7-2), e existe um backdoor que cria admin (7-1).

---

## 🔴 CRÍTICOS — corrigir ANTES de publicar (3)

| ID | Falha | Correção |
|----|-------|----------|
| **0-1** | `anon` (chave pública do bundle) lê TODOS `clientes`, `pedidos`, `pedido_itens`, `tabelas_preco` | `DROP` das 5 policies `Anon can read …` sensíveis; repensar "modo demo" p/ não usar dados reais |
| **7-2** | `configuracoes` (Stripe secret, SMTP password, webhook secret, api_token) legível por **qualquer usuário logado** | Tirar segredos da tabela (→ Supabase Secrets) ou SELECT só admin; expor ao front só `publishable_key`/flags; **trocar todas as chaves expostas** |
| **7-1** | `admin-reprovision-user` cria conta **admin** sem nenhuma autorização (e deleta usuários) | **Deletar a função** (é código morto + backdoor) |

## 🟠 ALTOS (2)
| ID | Falha | Correção |
|----|-------|----------|
| **7-4 / 2-A** | `stripe-checkout` confia no `amount` do cliente → pagar centavos por pedido caro | Recomputar o valor no servidor a partir do `pedido_id` |
| **7-3** | API pública (`/functions/api`) autentica com `configuracoes.api_token` (vaza pelo 7-2), service role total | Depende do 7-2; usar tokens hasheados da tabela `api_keys`, não o token global |

## 🟡 MÉDIOS (segurança & funcional)
- **6-S6** Stored XSS: campos `custom_code_*`/`custom_css` salvos p/ injeção em head/body — sanitizar onde renderiza.
- **6-S2/6-S3** `api_keys.key_value` e `oauth client_secret` em texto plano re-reveláveis (telas admin) — hashear, mostrar só na criação.
- **7-5** Sub-login (company_contacts buyer/viewer/manager) **não funciona** — falta policy de RLS p/ contato ver/criar pedidos da empresa.
- **2-C** "Privacy groups" de produto filtrados só no front — produtos restritos vazam na resposta de rede.
- **6-S8** Teste de webhook (Profile) faz `fetch` p/ URL arbitrária com dados reais de pedidos/clientes.
- **7-7** `manager`/`warehouse` entram em telas admin mas a RLS só-admin bloqueia escrita ("salvar que não salva").

## 🟡 TELAS / BOTÕES FALSOS (o que você pediu p/ caçar)
| Onde | O quê |
|------|-------|
| `ProductImport.tsx` | Tela inteira falsa (Choose File / Download Template / View Guide sem ação) |
| `settings/ProductStatusRules.tsx` | Tela inteira falsa ("Add Rule" sem ação) — duplica a aba real do ProductEdit |
| `CustomerEdit.tsx` | 3 abas falsas: Email Settings, Homepage Products, Admin Fields (não salvam); edição de endereço inline não persiste |
| `Produtos.tsx` | Filtros Brand / Privacy / Backorder não filtram |
| `admin/Pedidos.tsx` | Botão **Export** sem ação + ~8 filtros que não filtram |
| `PedidoDetalhe.tsx` (portal) | Botão **EXPORT** sem ação |
| `Catalogo.tsx` (portal) | Botão **PDF CATALOG** sem ação |
| `PaymentOptions.tsx` | "Stripe Connect" nunca conecta (fluxo fake) |
| `Configuracoes.tsx` | "Send Test Email" provavelmente quebrado (payload sem `type`) |
| `Profile.tsx` | Quickbooks Install/Start, "Add sample text", "Throttled Logins" (links mortos) |
| `ExportsLog.tsx` | Botão Download duplicado falso |
| `PdfCatalog.tsx` | "Select products" e filtro "Customer" sem efeito |

## 🟡 BUGS FUNCIONAIS menores
- `import_logs`/`export_logs`: colunas gravadas ≠ lidas → histórico pode aparecer vazio (5-1).
- `Coupons` e `SalesTax`: delete sem confirmação.
- `BulkUpdateOrders`: detecção de "pedido inexistente" não funciona (`count` nulo).
- `Dashboard` portal: "Total Orders" travado em "5+".
- `ProductEdit`: "Created/Updated" sempre mostram hoje; `saveSubData` não-transacional.
- `Categorias`: desativar esconde permanentemente.
- Senha mínima fraca (6 chars) em vários fluxos.
- 1-1: dois fluxos de reset de senha (um órfão vaza enumeração) + `Login.tsx`/`RecuperarSenha` órfãos.

---

## Ordem de correção sugerida
1. **Hoje (bloqueadores):** 0-1, 7-2 (+ trocar chaves), 7-1. São migrations curtas + deletar 1 função.
2. **Em seguida (alto):** 7-4 (Stripe server-side), 7-3 (após 7-2).
3. **Funcional/UX:** remover/implementar telas e botões falsos; corrigir sub-login (7-5) se o recurso for usado.
4. **Higiene:** XSS (6-S6), hashes de segredo (6-S2/3), confirmações de delete, senha forte, limpeza de código morto.

> Nada disso foi corrigido ainda — esta é só a auditoria. As correções dos 3 críticos são pequenas e podem ser feitas em uma migration + 1 ajuste de função.
