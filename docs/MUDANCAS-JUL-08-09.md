# Mudanças — batch 08–09/jul/2026 (go-live prep)

> Registro técnico COMPLETO das alterações feitas nesta rodada. Cada item:
> o que foi pedido, o que mudou (arquivo/commit), e como conferir.
> Frontend faz deploy AUTOMÁTICO no Vercel a cada push no `main` (não é pelo
> Lovable). Edge function `b2bwave-sync` é deploy separado (Lovable → Supabase).

---

## Como o deploy funciona (importante)
- **Frontend (React/Vite):** hospedado no **Vercel**, conectado ao GitHub. **Todo push no
  `main` gera deploy de produção automático** (~1–2 min). Por isso NÃO existe "publicar" no
  Lovable pro frontend — e não precisa. URL: `b2bpermshield.vercel.app`.
- **Edge function `b2bwave-sync`:** roda no Supabase (Lovable Cloud). **Não** sobe no push;
  precisa de redeploy explícito pelo Lovable (que gera um commit "Deployed b2bwave-sync").
- **Banco (migrations):** aplicadas manualmente no SQL editor.

---

## PRODUÇÃO — Status/Entrada/Dashboard

| Pedido | Implementação | Commit |
|--------|---------------|--------|
| Container # sincroniza o Tracking | Ao salvar com Container # (edição ou New Entry), o Tracking recebe o mesmo valor; não sobrescreve tracking manual diferente | `0c450e8` |
| Tirar container duplicado da lista | Coluna "Order # / Container" virou só "Order #" (container seguia no diálogo/Received) | `f6bad41` |
| Busca na Production Status | Barra de busca (produto/SKU/order/container/tracking) filtra lista ativa + Received | `3e001e0` |
| Container na New Entry = "On the way" | Linha com Container # nasce `status='a_caminho'` | `3e001e0` |
| Ordenação por setas (Status) | Cabeçalhos clicáveis (Product/Qty/Est Ready/ETA/Order/Status); padrão ETA (vazios no fim) | `3e001e0`, `9441f0a` |
| Setas no Dashboard (drill-down) | Product/ETA/Qty/Status clicáveis; padrão ETA | `ea56841`, `9441f0a` |
| Categoria ao lado do nome (Dashboard) | "Silver Grey (One Plus › Blue Box)"; tira tracking duplicado da linha | `bb0c7ac` |
| Inventory Adjustment (estilo QuickBooks) | Nova tela `/admin/estoque/adjustment`: todos os produtos c/ categoria, Qty on Hand, New Quantity, diff; grava estoque_log + activity_logs | `3202e8f` |
| Produção loga tudo no Activity Logs | criar/editar/deletar/duplicar/receber/status/tracking (entity_type `production`) | `3202e8f` |

## ACTIVITY LOGS
- Filtro "User" virou **dropdown de usuários** (nome+email); tipos Inventory/Production;
  linha de detalhes legível (Qty antes→depois, categoria, ref, memo). Commit `3202e8f`.

## PRODUTOS / CÓDIGO (sku)
| Pedido | Implementação | Commit |
|--------|---------------|--------|
| Code (sku) OPCIONAL + sem números automáticos | Só Name obrigatório; vazio→NULL; sync grava código real (sem sufixo) e casa por `b2bwave_id` | `8de1bbb`, `129791c` |
| Restaurar códigos zerados por engano | Sync repõe o código real do B2BWave (313 restaurados) | `129791c` |
| Códigos podem repetir (igual B2BWave) | DROP das UNIQUE de `produtos.sku`; UNIQUE passa a ser `b2bwave_id` | `b5ccc60`, `129791c` |
| Categorias em ÁRVORE nos dropdowns | Raiz, "- filho", "-- neto" por `ordem`+nome; helper `lib/categoryTree.ts` (Products/ProductEdit/Orders) | `129791c` |
| Related Products busca por NOME | Combobox (era campo de ID cru) | `1d60b0c` |

## VIEW AS / PRIVACIDADE
| Pedido | Implementação | Commit |
|--------|---------------|--------|
| Banner "Return to" ia sempre pra Customers | Dashboard→/admin, Orders→/admin/orders, Customers→/admin/customers (`clearViewAs(dest)`) | `0920e30` |
| Sessão errada no view-as (Nextgen) | Guarda: view-as só ativa se a sessão REAL for STAFF; senão limpa a chave e reinicia | `0920e30` |
| Filtros de Orders com buracos | 3 grids esburacados → 1 grid de 4 colunas | `0920e30` |

## PORTAL (cliente)
| Pedido | Implementação | Commit |
|--------|---------------|--------|
| Descrição do produto renderiza HTML | Sanitizado via `lib/sanitizeHtml.ts` (whitelist, sem script/on*/urls perigosas) | `e981a73` |
| Remover "Account" duplicado no dashboard | Ficou só "My Account"; stats em 3 colunas | `e981a73` |
| Recent Orders clicável | Cada linha → `/portal/pedidos/:id` | `2549ad4` |
| Total Spent só do ano | Soma pedidos do ano corrente; rótulo mostra o ano | `0ad8e21` |
| Catálogo em LISTA (tabela B2BWave) | Colunas Code/Product/Price/Min Qty/Available Qty/Status/Quantity/Add; toggle List/Photos | `0ad8e21` |
| Quantidade + estoque no card | Campo qty (grid+lista); "Available: N" negrito VERDE; "Sold Out" VERMELHO automático em estoque 0; abre em lista | `7a03831`, `e188180`, `9d7f71b` |
| My Account mostra endereço principal | Endereço do cadastro (tabela clientes) aparece com badge "Primary" | `1577dca` |
| Botão "New order" | Atalho no dashboard → catálogo | `6ab478a` |
| Modal add product mostra categoria | Caminho completo (localização › categoria) p/ distinguir homônimos | `6931b2b` |

## PRICE LISTS
| Pedido | Implementação | Commit |
|--------|---------------|--------|
| App remontava ao voltar pra aba (perdia edição) | `AuthContext`: TOKEN_REFRESHED/SIGNED_IN do MESMO user só atualiza sessão (ref `initializedUserRef`) | `842d5bd` |
| Save único no popup de preços | Save no rodapé salva TUDO em lote; linhas editadas destacadas; sai o save por linha | `842d5bd` |
| Input de preço sem setas | `appearance:textfield` | `842d5bd` |
| Duplicar price list | Botão ⧉ copia lista "(copy)" + todos os preços | `b5ccc60` |

## RELATED PRODUCTS (importação)
- **A API do B2BWave NÃO expõe related products** (confirmado na doc oficial). Vêm só no
  **export de produtos** (Products → Export), coluna **`related_products_buy_with`**
  (não "related_products"), com `-` como slot vazio, referenciando outros produtos por `product_sku`.
- Nova tela **Tools → Import Related Products** (`/admin/tools/import-related-products`):
  upload do `.xlsx`/`.csv`, casa produto principal por `b2b_product_id` (fallback sku),
  relacionados por `product_sku`, popula `produtos_relacionados`. Parser CSV RFC-4180 próprio +
  leitura `.xlsx` via SheetJS. Commits `551878f`, `1d60b0c`, `21dec50`, `f4564f7`.
- **Resultado do import real (09/jul):** 96 links, 19 produtos, 0 erros.
- Dependência nova: `xlsx` (SheetJS 0.18.5).

---

## MIGRAÇÕES SQL (todas já aplicadas — confirmado por diagnóstico)
| Arquivo | O que faz |
|---------|-----------|
| `20260706120000_estoque_log_staff.sql` | estoque_log: staff (admin/manager/warehouse) grava+lê |
| `20260708120000_produto_sku_opcional.sql` | `produtos.sku` DROP NOT NULL |
| `20260708130000_produtos_b2bwave_id_unique.sql` | índice único `produtos_b2bwave_id_uidx` (chave do sync) |
| `20260708140000_sku_repetivel_restaura.sql` | DROP das UNIQUE de sku (código pode repetir) |

Diagnóstico (08/jul) confirmou: sku_nullable=YES, sku_unique_restantes=0, b2bwave_id_uidx=1,
est_ready=1, estoque_log_staff=2, funcs_privacidade=4, cat_exec_authenticated=false (Bug 3 fechado),
prod_exec_anon=false. **Nada de SQL pendente.**

---

## VERIFICAÇÕES DE GO-LIVE (com dado real, não suposição)
- **Frontend:** Vercel API confirmou deploy de produção do último commit = READY.
- **Privacidade "view as":** SQL `categoria_visivel_para` p/ cliente K&G Design (grupo BELOCORE FL)
  retornou MIX correto de true/false (escopa por cliente).
- **Pedidos + total:** pedidos 2599/2601 com `total = subtotal − desconto + tax + shipping` (trigger ok);
  2600 = $0 (pedido de cotação, recurso "add sem preço").
- **Related products:** 96 links importados, 0 erros.

---

## BUG CORRIGIDO (09/jul, pós-import) — sync WIPAVA os relacionados importados
O passo de related do sync (adicionado por engano) DELETAVA os relacionados de todos os
produtos b2b e reinseria só o que a API trouxesse — como a API do B2BWave NÃO traz related
(confirmado: arrays sem campo related; único "relish"=is_bundle, uma flag), rodar o sync de
produtos **apagava os 96 links importados manualmente**. Correção: o sync **não toca mais** em
`produtos_relacionados` (related é 100% via tela Import). Marcador `SYNC_VERSION:related-v4`
confirma a versão sem-wipe. **Reimportar os relacionados SÓ DEPOIS do redeploy v4.**

## BACKLOG / PRÓXIMOS UPDATES (não urgente)
- **Opt-out de notificação por cliente** (pedido do dono, 2026-07-09): cada cliente poder
  desabilitar SMS e/ou Email. Hoje NÃO existe (sem campo de preferência em `clientes`).
  Precisa: (a) colunas em `clientes` (ex.: `notif_sms boolean default true`, `notif_email
  boolean default true`); (b) toggle na UI (admin CustomerEdit e/ou portal My Account);
  (c) `dispatch.ts`/`send-email` checarem a preferência do cliente antes de enviar a ELE
  (não afeta admin). Antes de ligar SMS pro cliente em produção: o dono do sistema vai
  validar/preparar o TEMPLATE de SMS (aba Notifications → Templates) — mensagem amigável.
- **Toggle dedicado "SMS pro cliente on/off"** (separado do admin): hoje o canal SMS é
  compartilhado admin+cliente no mesmo evento; não dá pra desligar só o do cliente sem
  código. Pequeno enhancement se o dono quiser esse controle fino. Enquanto isso, pausar
  SMS = Canais → SMS off (pausa admin+cliente).

## PASSADA FINAL DE AUDITORIA (09/jul, noite) — achados e correções
Auditoria final focada no código alterado no dia. **1 bug real + 4 acertos menores:**

1. **BUG (interruptor mestre × alerta):** canal desligado era tratado como FALHA no
   `_shared/dispatch.ts` → o `alertAdmin` mandava UM EMAIL POR EVENTO avisando "canal
   desligado" — anulava o propósito de desligar. Corrigido: desligado de propósito = SKIP
   (só registra no Notifications Log como `skip: channel disabled`); falha REAL de provider
   (Twilio/Resend com erro) continua alertando. **Requer redeploy do `notify-dispatch`.**
2. **i18n dos emails enviados:** SUBJECTS do dispatch estavam em PT ("Novo pedido recebido"...)
   — são os assuntos que o CLIENTE FINAL vê. Traduzidos + corpo/assunto do alerta de falha +
   motivos de skip no log + strings de teste do notify-dispatch. (Mesmo redeploy acima.)
3. **i18n frontend final:** últimos toasts/erros em PT traduzidos (ProductEdit privacidade,
   EmailSettings, EmailTemplates, toast do import de related).
4. **sanitizeHtml endurecido:** `<script>/<style>/<iframe>/...` agora são descartados COM o
   conteúdo (antes o texto interno — CSS/JS — viraria texto visível na descrição).
5. **Import related — BOM:** CSV do Excel vem com BOM; o 1º cabeçalho (`product_sku`) não
   casaria. Strip explícito `﻿` no parseCSV.
6. **Total Spent (portal) sem cancelados:** o card somava pedidos cancelados no total gasto
   do ano — número errado pro cliente. Agora exclui `cancelled`.

Verificado sem defeito nesta passada: import related (fluxo), sync v4 (não toca related),
catálogo tabela/qty/status, master switch (UI/flags), AuthContext (ref de sessão),
price lists (save único/duplicar), teste de canal com canal OFF (funciona por design —
teste é explícito do admin e bypassa o toggle).

## CASO ABERTO (10/jul) — send-email DEPLOYADA É VELHA (email vazando pro dev)
**Sintoma:** email de novo pedido chegando em `junior@wiseitsolutions.us` (email do dev, já
removido de todo o banco) MESMO com notificações desligadas. SMS corretamente não saiu (skip ok).
**Evidência da causa:** email do pedido #2609 veio com assunto/template PT ("Novo pedido
recebido") e remetente noreply@inwisepro.com, sem registro no notification_log — enquanto o teste
da aba Tests sai "New order received" (inglês). Banco limpo (recipients=só jess, configs NULL,
sem trigger/função com o email). Conclusão: **a edge function `send-email` nunca foi redeployada**
— a versão no ar é antiga (recipient velho, templates PT, sem checks email_on_*).
**Fix:** redeploy da `send-email` pelo Lovable (main atual) + listar TODAS as edge functions
deployadas com data (caçar outras órfãs).
**Verificação:** pedido teste com notificações OFF → zero emails; ON → admin só jess, em inglês.

## EMOJIS DOS TEMPLATES — sumiram (causa + solução)
O SQL `20260709160000` (templates em inglês) sobrescreveu os templates INTEIROS, apagando os
emojis adicionados pelo dono. Irrecuperável (overwrite no banco). Solução: recolocar na aba
Templates — nada regrava templates automaticamente; NÃO rodar aquele SQL de novo.

## PENDÊNCIAS
1. **Redeploy da edge function `b2bwave-sync`** (passo 1): há melhoria no repo não deployada
   (`d5e43fc`, related em lote) + marcador `SYNC_VERSION:related-v3`. Não bloqueia produção
   (related vem pela tela de import; sync de produtos funciona na versão atual). Só realinha
   repo↔servidor. Confirmar por: rodar Products→Sync Now e checar `sync_log.samples` conter
   `SYNC_VERSION:related-v3`.
2. **Pré-desligamento do B2BWave** (semana que vem): sync diferencial final + limpar dados de teste.
   Fazer com cuidado, junto.
