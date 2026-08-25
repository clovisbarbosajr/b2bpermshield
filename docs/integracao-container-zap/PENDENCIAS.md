# Integração ETA (Container ZAP) — pendências e decisões

## Decisões do dono (25/ago)
- ETA do **rastreio ao vivo** (arrival / eta_predicted / eta) **sobrescreve sempre**
  o que está na tela: "o ETA muda, às vezes o navio atrasa ou adianta. Dessa forma
  tá sempre atualizado".
- **Exceção decidida por mim (25/ago), reversível:** o ETA vindo da PLANILHA do
  tracker (`container_products.eta`, fonte `sheet`) só PREENCHE quando o campo está
  vazio — não sobrescreve. Motivo: é dado estático; deixá-lo sobrescrever faria uma
  data velha apagar o ETA digitado à mão **todo dia, para sempre**, sem jeito de
  fixar. O pedido "sobrescreve sempre" foi feito pensando no navio atrasar/adiantar,
  que é o rastreio ao vivo. Se o dono quiser o contrário, é remover uma condição
  em `sync-container-eta/index.ts`.
- Rodar **1× por dia, automático, sem falha**. Sem botão manual.
- Por isso a sincronização grava um registro de cada execução — "sem falha" só é
  verificável se der pra ver que rodou e quantos foram atualizados.

## P-A — Container # e Tracking # não se espelham (reportado 25/ago)
Palavras da Jessika: *"ele ainda nao ta identificando que container # eh a mesma
coisa que tracking #. Quando eu entro o numero no container # ele nao update o
tracking # e vice versa."*

Estado atual em `src/pages/admin/producao/ProducaoStatus.tsx`:
- `saveEdit` copia container → tracking, **mas só** quando o tracking está vazio ou
  é igual ao container ANTIGO (guarda pra não sobrescrever tracking digitado à mão).
- `saveTracking` (campo da lista) grava **só** `tracking`. Nunca preenche o container.

Ou seja: o espelhamento existe num sentido, parcial, e não existe no outro.

**Consequência para a integração de ETA:** se os dois campos são a mesma coisa na
prática, o cruzamento com o tracker precisa olhar `numero_container` **e**
`tracking` — senão a linha que só tem tracking preenchido nunca casa.

## Ordem combinada
1. ~~Integração de ETA~~ — **CONCLUÍDA e validada em produção em 25/ago/2026**
   (16 lidos, 13 casados, 13 atualizados, 0 erros). Ver `README.md`.
2. ~~P-A — espelhar container ↔ tracking~~ — **CONCLUÍDO 25/ago.**
   Regra em `src/lib/espelhoContainer.ts`, travada por 19 testes.

## P-A — como ficou

Assimétrico de propósito:

- **Editor (Container → Tracking):** preenche o tracking vazio, e arrasta o
  tracking que era só cópia do container antigo (corrigir um dígito leva os dois).
  Nunca por cima de um tracking digitado diferente.
- **Lista (Tracking → Container):** só preenche container **vazio**. Nunca
  sobrescreve. A lista ativa não exibe a coluna Container — escrever ali por cima
  seria cego, e `numero_container` é a chave do sync de ETA.

A primeira versão era simétrica e destruía o container real: assim que os dois
campos ficavam iguais, a regra "o outro só estava acompanhando" virava
indecidível, e salvar um número de courier no Tracking apagava o container.
Três rodadas de caçador/cético até fechar. Os casos estão em
`src/lib/espelhoContainer.test.ts` como testes de REGRESSAO — se algum voltar a
espelhar, o container do cliente some em produção.

**Consequência aceita:** container apagado de propósito volta se alguém salvar o
tracking ou clicar "On the way". Não dá para separar isso do backfill das linhas
antigas — os dois são o mesmo estado no banco. Sem perda de dado (o campo estava
vazio) e o audit log registra.

## Observação da execução real (25/ago)
Nos 13 itens que casaram, o container e o tracking estavam com o **mesmo valor**,
então o P-A não atrapalhou o cruzamento. Mas isso é coincidência dos registros
atuais, não garantia: uma linha preenchida só num dos campos continua casando
(a função consulta os dois), o problema do P-A é de digitação na tela.
