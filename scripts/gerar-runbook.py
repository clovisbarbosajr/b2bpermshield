# -*- coding: utf-8 -*-
"""Gera o runbook que o dono roda no SQL editor do Lovable, a partir dos
arquivos de migration — e CONFERE o que gerou.

    python scripts/gerar-runbook.py

Por que existe: o runbook EMBUTE o SQL. Quando um arquivo de migration muda
depois do runbook gerado, o dono roda a versao velha e a conferencia final
acusa 'FALTA' sem ninguem entender por que. Gerar de novo e mais seguro do que
lembrar de editar os dois.

O gerador CONFERE no fim que cada corpo escrito bate byte a byte com o arquivo
do repositorio. Ja peguei um mutante com essa checagem; sem ela, o gerador
poderia escrever qualquer coisa e se declarar pronto.

ATENCAO: nao edite o .md a mao. Edite AQUI e rode de novo — foi exatamente esse
o erro que criou este arquivo: a inclusao da `b2bwave-sync` na lista de deploy
foi feita direto no markdown, e regerar teria apagado a correcao em silencio.
"""
import io, os, re, sys

DIR = 'supabase/migrations'
DESTINO = 'C:/Users/clovi/Desktop/RODAR-NO-PERMSHIELD-parte2.md'
# `python scripts/gerar-runbook.py <outro-caminho>` escreve noutro lugar — usado
# para gerar num temporario e DIFERENCIAR antes de sobrescrever o arquivo que o
# dono pode estar lendo no meio da execucao.
if len(sys.argv) > 1:
    DESTINO = sys.argv[1]

PASSOS = [
    dict(arq="20260825320000_estoque_por_variante.sql",
         titulo="Estoque de tamanho/cor passa a dar baixa", risco="ALTO", retorno=False,
         oque="Hoje o estoque por tamanho nunca diminui com venda. Dois clientes compram o último M e passam os dois — e nem precisa ser ao mesmo tempo: como o número nunca baixa, dá para vender o M indefinidamente enquanto o produto tiver saldo somado.",
         obs="**RODE FORA DE HORÁRIO DE PICO.** Esta trava a tabela de variantes durante o preenchimento inicial, e a loja fica esperando — segundos, mas o cliente sente.\n>\n> A consulta de backup mostra se algum tamanho **já foi vendido além do que tem**. Se voltar linha, me avise antes de seguir."),

    dict(arq="20260825330000_item_produto_valido.sql",
         titulo="Item de pedido recusa produto desativado ou privado", risco="MÉDIO", retorno=False,
         oque="A permissão de criar item só verifica “o pedido é meu”. O produto não é olhado por ninguém — dá para pôr no pedido produto desativado, produto privado de outro grupo, ou marcado como não-vendável.",
         obs=None),

    dict(arq="20260825340000_log_auditoria_nao_forjavel.sql",
         titulo="Log de auditoria deixa de ser forjável", risco="ALTO", retorno=True,
         oque="Qualquer pessoa cadastrada podia escrever no seu log de auditoria, assinando com o nome de quem quisesse. Não corrompe o sistema — corrompe a explicação do que aconteceu, numa tabela que só você lê.",
         obs="A consulta de backup procura **forja que já exista**: linha cujo e-mail não bate com o do login que ela diz ser. Numa gravação legítima os dois sempre casam.\n>\n> **Se voltar alguma linha, me mande antes de seguir.**"),

    dict(arq="20260825350000_trava_colunas_item.sql",
         titulo="Item não nasce mais marcado como enviado", risco="MÉDIO", retorno=False,
         oque="O cliente conseguia criar o item do pedido já marcado como expedido. Na tela do depósito o pedido aparecia despachado sem ninguém ter despachado nada.",
         obs=None),

    dict(arq="20260825360000_preco_exige_conta_liberada.sql",
         titulo="Cliente suspenso para de ler sua régua de preço", risco="MÉDIO", retorno=True,
         oque="As permissões de preço olham a tabela de preço do cliente, mas não a situação da conta. Cliente que você suspende perde o catálogo — e continua lendo produto por produto o preço e a régua de desconto inteiros.",
         obs="A consulta de backup lista **quem perde acesso à régua de preço** na hora. É esperado que sejam contas bloqueadas. **Leia a lista** — se tiver alguém que você pretende reativar, tudo bem, ele volta ao normal quando a conta voltar."),

    dict(arq="20260825370000_view_as_diz_a_verdade.sql",
         titulo="O “ver como” para de mentir", risco="BAIXO", retorno=False,
         oque="Você abria “ver como” um cliente bloqueado e via o catálogo cheio, enquanto ele via zero. Não é falha de segurança — é a ferramenta que existe para responder “o que ele está vendo?” dando a resposta errada.",
         obs=None),

    dict(arq="20260825380000_cupom_consumo_no_servidor.sql",
         titulo="Limite de uso do cupom deixa de ser honra", risco="MÉDIO", retorno=True,
         oque="Quem contava o uso do cupom era o navegador. Bastava não fazer essa chamada para reusar um cupom de uso único quantas vezes quisesse. Agora conta no servidor — e devolve quando o pedido é cancelado, para cartão recusado não queimar o cupom.",
         obs="A consulta de backup mostra **o quanto deixou de ser contado** até aqui: compara o contador de cada cupom com os pedidos vivos que o usam.\n>\n> **Me mande o retorno** — se a diferença for grande, vale rever quais cupons ainda estão ativos."),

    dict(arq="20260825390000_pedido_minimo_no_servidor.sql",
         titulo="Pedido mínimo deixa de ser só do navegador", risco="MÉDIO", retorno=True,
         oque="O valor mínimo que você configura por cliente só era conferido na tela. Quem fechasse o carrinho sem passar por essa conferência entrava abaixo do mínimo do mesmo jeito. Agora quem confere é o servidor, e a regra passa a valer de verdade.",
         obs="A consulta de backup mostra **quantos pedidos já entraram abaixo do mínimo** de cada cliente. Nada do passado é alterado — ela só mede.\n>\n> **Me mande o retorno.** Se aparecer cliente com muitos, vale conferir se o mínimo dele está configurado do jeito que você quer.\n>\n> Depois de rodar, teste os DOIS lados: carrinho **abaixo** do mínimo tem que ser recusado com mensagem clara, e carrinho **acima** tem que passar. Sem o segundo teste, um gatilho que recusa tudo passaria por \"funcionando\" e a loja pararia de vender."),
]

# As edge functions que precisam de deploy.
#
# `b2bwave-sync` saiu em 02/set/2026 junto com a propria funcao: o cliente
# decidiu que o sistema nasce com zero pedidos e sem integracao com o B2BWave.
# O `diff_orders`/`diff_catalog` viviam dentro dela e foram embora junto — por
# isso o passo de comparacao no fim deste runbook tambem saiu.
EDGE = ["send-email", "stripe-checkout", "register-customer", "company-member"]


def extrai_backup(sql):
    m = re.search(r'-- BACKUP.*?\n(.*?)-- -{10,}\n\nBEGIN;', sql, flags=re.S)
    if not m:
        m = re.search(r'-- BACKUP.*?\n(.*?)-- -{10,}\n', sql, flags=re.S)
    if not m:
        return None
    linhas = [re.sub(r'^--\s?', '', l) for l in m.group(1).split('\n')]
    return '\n'.join(linhas).strip() or None


def corpo_executavel(sql):
    i = sql.index('\nBEGIN;')
    j = sql.rindex('COMMIT;') + len('COMMIT;')
    return sql[i + 1:j].strip()


CAB = """# Runbook — {N} migrations pendentes

Continuação do lote de 25/ago. **As 12 anteriores já rodaram.**

> ⚠️ **Se qualquer passo der erro, PARE.** Não pule para o próximo — me mande o erro.
> Nada aqui religa e-mail ou SMS. A notificação continua desligada.

Onde estiver **📩 me mande o retorno**, rode só a consulta de conferência primeiro,
me mande o resultado, e espere antes de rodar o SQL daquele passo.

---
"""
out = [CAB.replace("{N}", str(len(PASSOS)))]

corpos_escritos = {}

for n, p in enumerate(PASSOS, start=1):
    sql = io.open(os.path.join(DIR, p["arq"]), encoding='utf-8').read().replace('\r\n', '\n')
    backup = extrai_backup(sql)
    corpo = corpo_executavel(sql)
    corpos_escritos[p["arq"]] = corpo

    out.append(f"\n## PASSO {n} de {len(PASSOS)} — {p['titulo']}\n")
    out.append(f"**Risco: {p['risco']}**" + ("  ·  **📩 me mande o retorno**" if p["retorno"] else "") + "\n")
    out.append(f"`{p['arq']}`\n")
    out.append(f"\n{p['oque']}\n")
    if p["obs"]:
        out.append(f"\n> 🔴 **ATENÇÃO**\n>\n> {p['obs']}\n")
    if backup:
        out.append(f"\n### {n}.1 — Antes: confira o que vai mudar\n\n```sql\n{backup}\n```\n")
        out.append(f"\n### {n}.2 — Rode isto\n\n```sql\n{corpo}\n```\n")
    else:
        out.append(f"\n### Rode isto\n\n```sql\n{corpo}\n```\n")
    out.append("\n---\n")

out.append(f"""
## PASSO {len(PASSOS) + 1} — Conferência final

**📩 me mande o retorno**

```sql
WITH esperado(item, tipo) AS (
  VALUES
    ('a_trg_lock_item_cols',        'gatilho_itens'),
    ('trg_item_produto_valido',     'gatilho_itens'),
    ('trg_cupom_consome',           'gatilho_pedidos'),
    ('trg_cupom_devolve_status',    'gatilho_pedidos'),
    ('trg_cupom_devolve_delete',    'gatilho_pedidos'),
    ('trg_activity_log_identidade', 'gatilho_log'),
    ('trg_pedido_minimo',            'gatilho_itens'),
    ('fn_pedido_minimo',            'funcao'),
    ('conta_liberada_de',           'funcao'),
    ('fn_lock_item_cols',           'funcao'),
    ('fn_item_produto_valido',      'funcao'),
    ('fn_cupom_consome',            'funcao'),
    ('fn_activity_log_identidade',  'funcao'),
    ('cupom_consumido',             'coluna_pedidos'),
    ('estoque_reservado',           'coluna_variantes')
)
SELECT e.tipo, e.item,
  CASE
    WHEN e.tipo = 'gatilho_itens' AND EXISTS (
      SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.pedido_itens'::regclass
        AND NOT t.tgisinternal AND t.tgname = e.item) THEN 'OK'
    WHEN e.tipo = 'gatilho_pedidos' AND EXISTS (
      SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.pedidos'::regclass
        AND NOT t.tgisinternal AND t.tgname = e.item) THEN 'OK'
    WHEN e.tipo = 'gatilho_log' AND EXISTS (
      SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.activity_logs'::regclass
        AND NOT t.tgisinternal AND t.tgname = e.item) THEN 'OK'
    WHEN e.tipo = 'funcao' AND EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = e.item) THEN 'OK'
    WHEN e.tipo = 'coluna_pedidos' AND EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'pedidos'
        AND c.column_name = e.item) THEN 'OK'
    WHEN e.tipo = 'coluna_variantes' AND EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'produto_variantes'
        AND c.column_name = e.item) THEN 'OK'
    ELSE 'FALTA'
  END AS situacao
FROM esperado e
ORDER BY situacao, e.tipo, e.item;
```

E confirme que nada foi religado sem querer:

```sql
SELECT (SELECT count(*) FROM cron.job)               AS crons,
       (SELECT count(*) FROM net.http_request_queue) AS fila_http,
       (SELECT value ->> 'on' FROM public.sync_state WHERE key = 'envio_pausado') AS envio_pausado;
```

---

## PASSO {len(PASSOS) + 2} — Publish

---

## PASSO {len(PASSOS) + 3} — Deploy das edge functions, no chat do Lovable

""" + " · ".join(f"`{e}`" for e in EDGE) + f"""

> 🔴 **ATENÇÃO**
>
> Push no GitHub **não** publica edge function. Sem este passo, as correções de
> e-mail, pagamento, cadastro e equipe não entram.

---

## PASSO {len(PASSOS) + 4} — Me avisar

Aí eu confiro o resultado dos blocos e digo se ficou consistente.

> A comparação com o B2BWave (`diff_orders` / `diff_catalog`) que ficava aqui
> **saiu em 02/set/2026**: as duas viviam dentro da `b2bwave-sync`, e o sync foi
> removido por decisão do cliente — o sistema nasce com zero pedidos e sem
> integração. Não há mais com o que comparar.
""")

texto = "".join(out)
io.open(DESTINO, 'w', encoding='utf-8', newline='\r\n').write(texto)

# ---- CONFERE o que acabou de escrever. ----
rb = io.open(DESTINO, encoding='utf-8').read().replace('\r\n', '\n')
blocos = [b.strip() for b in re.findall(r'```sql\n(.*?)```', rb, flags=re.S)]
ruins = [arq for arq, corpo in corpos_escritos.items() if corpo not in blocos]
if ruins:
    print("FALHOU — corpo escrito nao bate com o arquivo:", file=sys.stderr)
    for r in ruins:
        print("  -", r, file=sys.stderr)
    sys.exit(1)

print(DESTINO)
print(f"{len(PASSOS)} passos, {len(blocos)} blocos SQL — todos conferidos contra {DIR}/")
