# Progresso

## ⏳ Pendentes
- [ ] Publish do front (T13, T16, T18-U1, T19) — dono
- [ ] T17 — checkout: frete 0 silencioso quando o cliente não tem shipping option atribuída

## 🚫 Bloqueadas
- [ ] Telas de troca de senha (ResetPassword, EditPassword) — mesma correção do login — aguarda OK do dono
- [ ] Produtos sem preço (base 0 e fora de qualquer lista) — dado, Jessika cadastra
- [ ] T20 — sub-login não herda a lista de preço do pai na tela (RLS de `clientes`) — SQL proposto, decisão do dono
- [ ] T15 — edge `send-email`: resposta genérica para AUTH quando recusado (oráculo) — decisão do dono
- [ ] T9 — 1 produto com foto morta na origem ("DO NOT SHIP") — Jessika decide
- [ ] 3 logins órfãos (admin@permshield.com, clovisbarbosajr@gmail.com, jessika.andrade@hotmail.com) — dono decide

## ✅ Concluídas e validadas
- [x] T1 — sync do B2BWave e API de saída removidos; zero pedidos
- [x] T2 — as 14 decisões da Jessika no código e no banco
- [x] T3 — trigger de status de fábrica + guardas do pré-order negativo
- [x] T4 — sistema novo: só catálogo, equipe e o cliente Zap
- [x] T5 — status de produto normalizado como o banco (portal)
- [x] T6 — erro real da edge ao criar cliente; e-mail preso liberado
- [x] T7 — índice em `estoque_log`: delete de produto sem timeout
- [x] T8 — filtros Parent/Sub-category em /admin/products
- [x] T10 — status normalizado no admin (lista + ficha)
- [x] T11 — 287 fotos copiadas do Cloudinary do B2BWave para o nosso storage
- [x] T12 — varredura: nada mais depende do B2BWave
- [x] T13 — telas não afirmam "link sent" quando o servidor recusa
- [x] T14 — `copiar-fotos-cloudinary` removida do deploy e do repo
- [x] T16 — checkout: endereço da conta listado e pré-selecionado; endereço obrigatório; sem duplicatas
- [x] T18 — login: exceção vira erro visível, botão não trava (confirmado pelo dono)
- [x] T19 — catálogo: preços em lote (~12-16 requisições em vez de ~1.000)
