# Workflow de varredura de falhas

Arquivo: `.claude/workflows/varredura-falhas.js`

## Como usar

Peça numa conversa nova:

> Rode o workflow `varredura-falhas`

(ou "use um workflow para procurar falhas" — o Claude resolve o nome).

## O que ele faz

Três fases, com os agentes rodando em paralelo:

1. **Varredura** — 6 agentes, um por área:
   - `ui-portal` — **roda o app de verdade** e exercita a interface do portal:
     clica botões, abre dialogs, submete formulários, testa mobile/desktop,
     lê o console do browser
   - `ui-admin` — mesma coisa nas telas de admin (abas, filtros, paginação,
     modais)
   - `portal-logica` — preço exibido × cobrado, estoque, carrinho, privacidade
   - `admin-logica` — saves que perdem dado, erro ignorado com toast de sucesso,
     dupla submissão, permissões
   - `edge-functions` — destinatário errado, template com placeholder vazio,
     envio duplicado, gate de autorização
   - `banco` — RLS, funções SECURITY DEFINER, lógica de trigger

2. **Verificação adversarial** — cada achado vai para um agente **cético**, que
   tenta **refutar** lendo o código. Só sobrevive o que ele confirma como real.
   Isso corta os falsos positivos (foi o que mais deu trabalho nas rodadas
   manuais).

3. **Síntese** — relatório consolidado, agrupado por gravidade, com a correção
   sugerida em uma linha. O que depende de regra de negócio é marcado como
   **"precisa de decisão do dono"** em vez de sair corrigido.

## O que já vem embutido no prompt dos agentes

- **Só falhas reais.** Nada de melhoria de estilo/arquitetura — é sistema de uso
  interno.
- **Lista do que já foi corrigido** (as 28 falhas desta sessão) para não
  reportarem de novo.
- **Lista do que já é conhecido e está em aberto** (as 3 críticas de trigger, a
  comissão, o limite de 1000 linhas etc.).
- Regra do projeto: nunca usar "Navarro Medical" em exemplo; usar **INWISE**.

## Manutenção

Quando uma rodada corrigir falhas novas, **acrescente-as à lista
"JA CORRIGIDO"** no topo do `varredura-falhas.js`. Sem isso, a próxima rodada
gasta tempo reencontrando o que já foi resolvido.

## Por que a parte de interface importa

As três varreduras de 26/jul olharam **só a lógica do código**. Nenhuma delas
clicou em nada. Bugs de interface (botão sem efeito, filtro que não filtra,
modal que perde o que foi digitado, layout que esconde um botão) passariam
despercebidos — por isso as duas primeiras áreas do workflow rodam o app e
exercitam a UI de verdade.

**Limitação conhecida:** sem credenciais de login, as rotas protegidas
redirecionam. O agente é instruído a **dizer claramente o que ficou sem testar**
em vez de fingir cobertura. Para varrer o admin logado de verdade, seria preciso
um usuário de teste.
