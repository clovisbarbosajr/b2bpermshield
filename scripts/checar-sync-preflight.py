# -*- coding: utf-8 -*-
"""Pre-voo do religamento do sync.  ->  `python scripts/checar-sync-preflight.py`

NAO E PORTAO. Nao roda no `npm test` e nao reprova nada — e um RELATORIO para ler
antes de religar a sincronizacao, porque foi assim que o incidente de 25/ago
comecou: uma correcao de paginacao fez o sync reconciliar 1.147 pedidos, cada
mudanca de status disparou o gatilho de notificacao, e sairam 1.508 SMS.

Depois daquele dia o banco ganhou uma duzia de gatilhos novos. A pergunta que
este script responde e: "quando o sync voltar e reescrever esses ~1.150 pedidos,
QUAL gatilho vai agir sobre eles?"

Ler o resultado: "NENHUMA" na coluna de isencao nao significa problema — significa
CONFERIR A MAO. Varios gatilhos sao seguros por outro motivo (casam pelo usuario
logado, que o sync nao tem; ou dependem de um dado que o sync nunca grava).


Para CADA gatilho que dispara nas tabelas que o sync escreve, verifica se a
funcao dele tem alguma isencao que deixe o sync passar:

  - `auth.role() = 'service_role'`  (o sync usa a service key)
  - `auth.uid() IS NULL`            (idem, a service key nao carrega `sub`)
  - `b2bwave_order_id IS NOT NULL`  (pedido importado)
  - `_is_synced`                    (variavel com a mesma checagem)

Gatilho SEM nenhuma delas e um que vai agir sobre os ~1.150 pedidos importados
quando o sync voltar — que e exatamente como o incidente dos SMS comecou.
"""
import io, os, re

DIR = 'supabase/migrations'
TABELAS = ('pedidos', 'pedido_itens', 'produtos', 'produto_variantes', 'clientes')

# ultima definicao vence
gatilhos = {}   # nome -> (tabela, funcao, arquivo)
funcoes = {}    # nome -> (corpo, arquivo)

for f in sorted(os.listdir(DIR)):
    if not f.endswith('.sql'):
        continue
    sql = io.open(os.path.join(DIR, f), encoding='utf-8').read()
    codigo = '\n'.join(l for l in sql.split('\n') if not l.lstrip().startswith('--'))

    for m in re.finditer(
        r'CREATE\s+TRIGGER\s+(\w+)\s+(.*?)\s+ON\s+public\.(\w+)(.*?)EXECUTE\s+FUNCTION\s+public\.(\w+)',
        codigo, flags=re.S | re.I):
        nome, quando, tabela, _, fn = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        if tabela in TABELAS:
            gatilhos[nome] = (tabela, fn, f, ' '.join(quando.split()))

    # Corpo da funcao: do CREATE ate o $$ de FECHAMENTO.
    #
    # A primeira versao exigia `\n$$;`, e a maioria das funcoes deste projeto
    # termina com "END $$;" ou "END; $$;" na MESMA linha — entao ela nao achava
    # quase nenhuma, o corpo vinha vazio, e o relatorio dizia que TODOS os 24
    # gatilhos estavam sem isencao. Verificador que acusa tudo e tao inutil
    # quanto um que nao acusa nada.
    for m in re.finditer(r'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)\s*\(', codigo, flags=re.I):
        nome_fn = m.group(1)
        abre = codigo.find('$$', m.end())
        if abre == -1:
            continue
        fecha = codigo.find('$$', abre + 2)
        if fecha == -1:
            continue
        funcoes[nome_fn] = (codigo[abre + 2:fecha], f)

    # gatilhos dropados sem recriar
    for m in re.finditer(r'DROP\s+TRIGGER\s+IF\s+EXISTS\s+(\w+)\s+ON\s+public\.(\w+)\s*;', codigo, flags=re.I):
        pass  # o CREATE logo depois reinsere; se nao houver, fica o registro antigo

ISENCOES = [
    (r"auth\.role\(\)\s*=\s*'service_role'", "service_role"),
    (r"auth\.uid\(\)\s+IS\s+NULL", "auth.uid() NULL"),
    (r"b2bwave_order_id\s+IS\s+NOT\s+NULL", "pedido importado"),
    (r"_is_synced", "_is_synced"),
    # Forma INVERTIDA, que varios usam: "so age se NAO for do sync".
    # `IF NEW.b2bwave_order_id IS NULL THEN <faz o trabalho> END IF;`
    # Sem esta linha o relatorio acusava `fn_pedido_total_appside` e
    # `fn_release_stock_on_item_delete`, que sao isentos — alarme falso.
    (r"b2bwave_order_id\s+IS\s+NULL", "so age se NAO for do sync"),
    (r"_b2b\s+IS\s+NULL", "so age se NAO for do sync"),
    (r"coupon_id\s+IS\s+NULL", "sem cupom (o sync nunca grava cupom)"),
]

# Gatilhos SEM isencao automatica que ja foram conferidos A MAO (25/ago).
# Ficam aqui para o relatorio nao mandar refazer a mesma investigacao — e para
# que, se a funcao MUDAR, alguem releia o motivo em vez de confiar no carimbo.
VEREDITOS = {
    "trg_block_unapproved_suborder":
        "OK — casa por `c.user_id = auth.uid()`; o sync nao tem usuario, nao casa",
    "trg_cupom_devolve_delete":
        "OK — exige `OLD.coupon_id IS NOT NULL`; o sync nunca mapeia cupom",
    "trg_low_stock_notify":
        "OK — canal desligado + so ao CRUZAR o limite + teto de 10/hora",
    "trg_order_status_notify":
        "OK — trava A1 (`notificavel`); o sync grava o campo, nao usa o default",
    "trg_subuser_inherit_pricelist":
        "OK — so PREENCHE tabela de preco nula; nunca sobrescreve",
    "update_clientes_updated_at":
        "OK — so `NEW.updated_at = now()`",
    "update_pedidos_updated_at":
        "OK — so `NEW.updated_at = now()`",
    "update_produtos_updated_at":
        "OK — so `NEW.updated_at = now()`",
}

print(f"{'GATILHO':<40} {'TABELA':<17} ISENCAO DO SYNC")
print("-" * 92)
sem = []
for nome in sorted(gatilhos):
    tabela, fn, arq, quando = gatilhos[nome]
    corpo, _ = funcoes.get(fn, ("", ""))
    achadas = [r for p, r in ISENCOES if re.search(p, corpo, flags=re.I)]
    if achadas:
        marca = ", ".join(achadas)
    elif nome in VEREDITOS:
        marca = "conferido a mao: " + VEREDITOS[nome]
    else:
        marca = "*** NENHUMA — CONFERIR ***"
        sem.append((nome, tabela, fn, quando))
    print(f"{nome:<40} {tabela:<17} {marca}")

print()
if sem:
    print("GATILHO NOVO, NUNCA CONFERIDO — leia a funcao antes de religar o sync:")
    for nome, tabela, fn, quando in sem:
        print(f"  {nome}  ({tabela}, {quando})  ->  {fn}()")
else:
    print("Nenhum gatilho novo desde a ultima conferencia.")
    print("Os 8 sem isencao automatica estao com veredito a mao (veja acima).")
