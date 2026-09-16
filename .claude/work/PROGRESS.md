# Progresso

## 🔄 Em andamento
- [ ] Lane A — T16 — Implementação — U1 banner ficha ilegível, U2 helper de endereços, U3 default persistente, U4 país

## ⏳ Pendentes
- [ ] Publish do front (T13) — dono
- [ ] T17 — checkout: frete 0 silencioso quando o cliente não tem shipping option atribuída

## 🚫 Bloqueadas
- [ ] T9 — 1 produto com foto morta na origem ("Select 3/4 x 7.48 - DO NOT SHIP") — Jessika decide se sobe
- [ ] T15 — edge `send-email`: resposta genérica para AUTH quando recusado (oráculo de enumeração) — decisão do dono
- [ ] 3 logins órfãos (admin@permshield.com, clovisbarbosajr@gmail.com, jessika.andrade@hotmail.com) — dono decide

## ✅ Concluídas e validadas
- [x] T1 — sync do B2BWave e API de saída removidos; zero pedidos
- [x] T2 — as 14 decisões da Jessika no código e no banco
- [x] T3 — trigger de status de fábrica + guardas do pré-order negativo
- [x] T4 — sistema novo: só catálogo, equipe e o cliente Zap
- [x] T5 — status de produto normalizado como o banco (portal)
- [x] T6 — erro real da edge ao criar cliente; e-mail preso liberado (login órfão apagado)
- [x] T7 — índice em `estoque_log`: delete de produto sem timeout (aplicado)
- [x] T8 — filtros Parent/Sub-category em /admin/products
- [x] T10 — status normalizado no admin (lista + ficha)
- [x] T11 — 287 fotos copiadas do Cloudinary do B2BWave para o nosso storage
- [x] T12 — varredura: nada mais depende do B2BWave; pode cancelar
- [x] T13 — telas não afirmam "link sent" quando o servidor recusa (torneira/teto)
- [x] T14 — `copiar-fotos-cloudinary` removida do deploy e do repo
