export const meta = {
  name: 'varredura-falhas',
  description: 'Varredura do PermShield atras de falhas REAIS (codigo + interface/cliques), com verificacao adversarial',
  whenToUse: 'Quando o dono pedir "procure falhas", "de uma volta no sistema" ou uma auditoria ampla',
  phases: [
    { title: 'Varredura', detail: 'agentes em paralelo por area, incluindo UI/cliques' },
    { title: 'Verificacao', detail: 'cada achado e refutado por um agente ceptico' },
    { title: 'Sintese', detail: 'consolida so o que sobreviveu, ordenado por gravidade' },
  ],
}

// ── Regras do projeto que TODO agente precisa respeitar ──────────────────────
const REGRAS = `
CONTEXTO (PermShield — sistema B2B interno de pisos, React+Vite+Supabase/Deno):
- Reporte APENAS falhas REAIS que causam bug, perda de dado, numero errado,
  cobranca errada ou brecha de acesso. NAO reporte melhorias de estilo,
  arquitetura, "boas praticas", refactor ou preferencia pessoal.
- Sistema de USO INTERNO: nao inventar hardening desnecessario.
- Em teste/exemplo, NUNCA usar "Navarro Medical" (outra empresa). Usar "INWISE".
- Se nao tiver certeza que quebra na pratica, marque "suspeita".

JA CORRIGIDO — NAO reportar de novo:
- view-as isolado por aba + admin-only; guarda de impersonacao; aba zumbi
- anti-relay do send-email (gate final); BCC em links de auth; request_magic_link
  no master switch; statusLabels desatualizado
- carrinho do view-as por cliente; cupom incrementado antes do pagamento
- key React do carrinho; saved-for-later por produto_id
- ProductEdit: save de variantes + delete/insert sem checar erro
- ImportCustomers rebaixando clientes; ImportProductDiscounts com preco:null
- b2bwave-sync zerando estoque_reservado e gravando status em PT
- BulkUpdateOrders por numero nao-unico; Relatorios (12 meses / cancelados)
- Estoque.tsx logando antes do update; PhoneInput corrompendo numero colado
- stripe-checkout metadata sobrescrevendo pedido_id

JA CONHECIDO E EM ABERTO (nao reportar como novo — ver docs/HANDOFF-2026-07-26.md):
- 3 criticas de trigger: reserva de estoque com UPDATE...FROM; cupom revalidado
  em UPDATE; tax_customer_group_id fora do lock de colunas
- comissao do representante calculada sobre total (com imposto/frete)
- limite de 1000 linhas nos relatorios; filtro de data UTC vs local
- API publica com roteamento de path provavelmente quebrado
- parsers CSV ingenuos; ImportsLog lendo colunas erradas
- sub-usuario: endereco da Conta nao aparece no checkout; funcionario removido
  ainda loga

FORMATO DA RESPOSTA: lista estruturada, curta, sem dumps de codigo. Para cada
achado: arquivo:linha | o que esta errado | cenario concreto (entrada -> resultado
errado) | gravidade (alta/media/baixa).
`

const ACHADOS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['achados'],
  properties: {
    achados: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['arquivo', 'problema', 'cenario', 'gravidade'],
        properties: {
          arquivo: { type: 'string', description: 'caminho:linha' },
          problema: { type: 'string' },
          cenario: { type: 'string', description: 'entrada concreta -> resultado errado' },
          gravidade: { type: 'string', enum: ['alta', 'media', 'baixa'] },
          suspeita: { type: 'boolean' },
        },
      },
    },
  },
}

const VEREDITO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['real', 'motivo'],
  properties: {
    real: { type: 'boolean', description: 'true so se o bug realmente ocorre no fluxo atual' },
    motivo: { type: 'string' },
  },
}

// ── Areas de varredura ───────────────────────────────────────────────────────
// UI/cliques entra aqui: e o que faltou nas 3 primeiras rodadas (que olharam
// so logica). Roda o app de verdade e exercita a interface.
const AREAS = [
  {
    key: 'ui-portal',
    prompt: `Rode o app (preview_start com {name:"dev"}, .claude/launch.json, porta 8080) e
EXERCITE A INTERFACE do PORTAL DO CLIENTE como usuario: navegue as rotas publicas e do portal,
clique botoes, abra dialogs, preencha e submeta formularios, redimensione (mobile/desktop).
Procure: botao que nao faz nada; link/rota quebrada (404, tela branca); form que submete sem
validar ou que trava; dialog que nao fecha; estado que nao atualiza apos acao; erro no console
do browser; layout quebrado que ESCONDE conteudo ou torna botao inalcancavel; spinner infinito.
Use read_console_messages e preview_logs pra pegar erro real. NAO reporte gosto visual.`,
  },
  {
    key: 'ui-admin',
    prompt: `Rode o app (preview_start {name:"dev"}) e EXERCITE A INTERFACE do ADMIN: /admin e
subrotas (orders, customers, products, settings, producao, reports). Clique, abra modais,
troque abas, use filtros e paginacao. Procure: aba/filtro que nao filtra nada; paginacao que
pula ou repete pagina; botao sem efeito; modal que perde o que foi digitado; tabela que quebra
com dado vazio; erro no console. Sem login de admin as rotas protegidas redirecionam — nesse
caso REPORTE o que conseguiu exercitar e diga claramente o que ficou sem testar.`,
  },
  {
    key: 'portal-logica',
    prompt: `Analise a LOGICA do portal do cliente: src/pages/portal/*.tsx, src/contexts/CartContext.tsx,
src/lib/pricing.ts. Foco: preco exibido != preco cobrado; estoque exibido errado; quantidade
minima/maxima; reorder; privacidade (produto/categoria que o cliente nao deveria ver);
useEffect com deps erradas; null sem guarda.`,
  },
  {
    key: 'admin-logica',
    prompt: `Analise a LOGICA das telas de admin: src/pages/admin/**/*.tsx. Foco: save que perde
dado (payload parcial, delete+insert sem checar erro); erro de banco ignorado com toast de
sucesso; dupla submissao; calculo errado em pedido/estoque/imposto; query com filtro errado;
permissao (acao de admin acessivel a manager/warehouse).`,
  },
  {
    key: 'edge-functions',
    prompt: `Analise as edge functions: supabase/functions/**/index.ts e _shared/. Foco: destinatario
errado de email/SMS; placeholder de template nunca substituido; envio duplicado; gate de
autorizacao ausente ou validando campo diferente do usado; erro silencioso que deveria ser
logado; valor vindo do cliente usado sem validar contra o banco.`,
  },
  {
    key: 'banco',
    prompt: `Analise o banco: supabase/migrations/*.sql. Reconstrua o estado final aplicando
CREATE OR REPLACE em ordem cronologica. Foco: RLS que deixa cliente ver/editar dado de outro;
funcao SECURITY DEFINER sem gate de papel; trigger com logica errada (dupla contagem, valor que
nao volta, condicao que nunca dispara); UPDATE...FROM com join que casa varias linhas; migration
nova que reverte restricao de uma anterior.`,
  },
]

// ── Fase 1+2: pipeline (cada area verifica assim que termina) ────────────────
phase('Varredura')
const porArea = await pipeline(
  AREAS,
  (a) => agent(`${REGRAS}\n\nAREA: ${a.key}\n\n${a.prompt}`, {
    label: `varre:${a.key}`, phase: 'Varredura', schema: ACHADOS_SCHEMA,
  }),
  (res, a) => {
    const achados = res?.achados ?? []
    if (!achados.length) return []
    // Verificacao adversarial: o ceptico tenta REFUTAR cada achado.
    return parallel(achados.map((f) => () =>
      agent(
        `Voce e um revisor CETICO. Tente REFUTAR este achado lendo o codigo real.\n` +
        `Arquivo: ${f.arquivo}\nProblema: ${f.problema}\nCenario: ${f.cenario}\n\n` +
        `Responda real=true SOMENTE se o bug realmente ocorre no fluxo atual do sistema ` +
        `(o caminho e alcancavel e o resultado e mesmo errado). Na duvida, real=false.`,
        { label: `verifica:${a.key}`, phase: 'Verificacao', schema: VEREDITO_SCHEMA },
      ).then((v) => ({ ...f, area: a.key, verdito: v })),
    ))
  },
)

const confirmados = porArea.flat().filter(Boolean).filter((f) => f.verdito?.real)
const ordem = { alta: 0, media: 1, baixa: 2 }
confirmados.sort((a, b) => (ordem[a.gravidade] ?? 3) - (ordem[b.gravidade] ?? 3))
log(`${confirmados.length} achados confirmados apos verificacao adversarial`)

// ── Fase 3: sintese ──────────────────────────────────────────────────────────
phase('Sintese')
const relatorio = await agent(
  `Consolide os achados CONFIRMADOS abaixo num relatorio curto pro dono do sistema ` +
  `(nao-tecnico no detalhe, direto no impacto). Agrupe por gravidade. Para cada um: ` +
  `o que quebra na pratica, arquivo:linha, e a correcao sugerida em 1 linha. ` +
  `Se algo depender de REGRA DE NEGOCIO, marque como "precisa de decisao do dono" ` +
  `em vez de sugerir correcao.\n\n${JSON.stringify(confirmados, null, 2)}`,
  { label: 'sintese', phase: 'Sintese' },
)

return { total: confirmados.length, confirmados, relatorio }
