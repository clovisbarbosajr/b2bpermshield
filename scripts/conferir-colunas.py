# -*- coding: utf-8 -*-
"""Confere que as colunas citadas pelas migrations PENDENTES existem de verdade.

    python scripts/conferir-colunas.py [arquivo.sql ...]

Sem argumento, confere toda migration ainda nao rodada (as de 20260825320000 em
diante).

POR QUE EXISTE: duas vezes em 25/ago eu mandei o dono rodar SQL com nome de
coluna que eu tinha inventado — `sync_state.valor` (o certo e `value`) foi a
segunda, e ele bateu no erro na tela. O `check-migrations.mjs` pega sintaxe;
nao pega nome que nao existe. Este pega.

COMO FUNCIONA: monta o schema lendo TODAS as migrations em ordem (CREATE TABLE,
ALTER TABLE ADD COLUMN, DROP COLUMN, RENAME) e depois procura, nos arquivos
alvo, referencias `alias.coluna` / `tabela.coluna` que nao existam.

LIMITES, ditos de frente: e leitura de texto, nao um parser de SQL. Nao entende
CTE, subconsulta com alias derivado, nem `RECORD`. Por isso so acusa quando tem
CERTEZA — tabela conhecida, coluna ausente. Prefere calar a gritar errado: um
relatorio que acusa demais nao e lido, e ja errei assim tres vezes hoje.
"""
import io, os, re, sys, glob

DIR = 'supabase/migrations'
CORTE = '20260825320000'   # daqui em diante = ainda nao rodada

# Tabelas que nao sao do schema `public` do projeto ou que nao vale a pena mapear.
IGNORAR_TABELAS = {
    'auth', 'storage', 'cron', 'net', 'pg_catalog', 'information_schema',
    'pg_trigger', 'pg_proc', 'pg_namespace', 'pg_class', 'excluded',
    'new', 'old', 'tg_argv',
}


def montar_schema():
    """tabela -> set(colunas), lendo as migrations em ordem cronologica."""
    schema = {}
    for caminho in sorted(glob.glob(os.path.join(DIR, '*.sql'))):
        sql = io.open(caminho, encoding='utf-8', errors='replace').read()
        # Sem comentarios de linha, para nao capturar exemplo comentado.
        codigo = '\n'.join(l for l in sql.split('\n') if not l.lstrip().startswith('--'))

        # CREATE TABLE public.x ( ... )
        for m in re.finditer(
                r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\((.*?)\n\s*\)\s*;',
                codigo, flags=re.S | re.I):
            tabela, corpo = m.group(1).lower(), m.group(2)
            cols = schema.setdefault(tabela, set())
            for linha in corpo.split('\n'):
                linha = linha.strip()
                if not linha or linha.startswith(')'):
                    continue
                # Ignora restricoes de tabela.
                if re.match(r'(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE)\b', linha, flags=re.I):
                    continue
                m2 = re.match(r'"?(\w+)"?\s', linha)
                if m2:
                    cols.add(m2.group(1).lower())

        for m in re.finditer(
                r'ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?(\w+)\s+(.*?);',
                codigo, flags=re.S | re.I):
            tabela, resto = m.group(1).lower(), m.group(2)
            cols = schema.setdefault(tabela, set())
            for a in re.finditer(r'ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?', resto, flags=re.I):
                cols.add(a.group(1).lower())
            for d in re.finditer(r'DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?', resto, flags=re.I):
                cols.discard(d.group(1).lower())
            for r in re.finditer(r'RENAME\s+(?:COLUMN\s+)?"?(\w+)"?\s+TO\s+"?(\w+)"?', resto, flags=re.I):
                cols.discard(r.group(1).lower())
                cols.add(r.group(2).lower())
    return schema


def alvos():
    if len(sys.argv) > 1:
        return sys.argv[1:]
    return [c for c in sorted(glob.glob(os.path.join(DIR, '*.sql')))
            if os.path.basename(c)[:14] >= CORTE]


def conferir(caminho, schema):
    sql = io.open(caminho, encoding='utf-8', errors='replace').read()
    codigo = '\n'.join(l for l in sql.split('\n') if not l.lstrip().startswith('--'))

    # Apelidos: `FROM public.pedidos p` / `JOIN clientes c` / `UPDATE x AS y`
    # Apelido e de STATEMENT, nao de arquivo. `p` pode ser `pedidos` num trecho
    # e `produtos` noutro — resolver por arquivo inteiro faz o ultimo ganhar e
    # acusa a linha errada. Foi exatamente isso na primeira versao: tres alarmes
    # falsos, os tres por este motivo.
    #
    # Conserto conservador: apelido ligado a MAIS DE UMA tabela no arquivo vira
    # AMBIGUO e nao e julgado. Perde alcance nesses casos; em troca nao grita
    # errado. O caso que mais importa — prefixo que e NOME DE TABELA, como
    # `sync_state.valor`, o erro que chegou na tela do dono — nao usa apelido e
    # continua coberto.
    candidatos = {}
    for m in re.finditer(
            r'\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:public\.)?(\w+)\s+(?:AS\s+)?(\w+)\b',
            codigo, flags=re.I):
        tab, ap = m.group(1).lower(), m.group(2).lower()
        if ap in ('set', 'where', 'on', 'using', 'select', 'values', 'as'):
            continue
        if tab in schema:
            candidatos.setdefault(ap, set()).add(tab)
    apelido = {ap: next(iter(t)) for ap, t in candidatos.items() if len(t) == 1}
    ambiguos = {ap for ap, t in candidatos.items() if len(t) > 1}

    achados = []
    for m in re.finditer(r'\b(\w+)\.(\w+)\b', codigo):
        pre, col = m.group(1).lower(), m.group(2).lower()
        if pre in IGNORAR_TABELAS or pre in ambiguos:
            continue
        tabela = apelido.get(pre, pre if pre in schema else None)
        if tabela is None:
            continue                       # prefixo desconhecido: cala
        cols = schema.get(tabela, set())
        if not cols:
            continue
        if col not in cols:
            linha = codigo[:m.start()].count('\n') + 1
            achados.append((linha, f"{m.group(1)}.{m.group(2)}", tabela, col))
    return achados


def main():
    schema = montar_schema()
    print(f"schema montado: {len(schema)} tabelas\n")
    total = 0
    for caminho in alvos():
        achados = conferir(caminho, schema)
        nome = os.path.basename(caminho)
        if not achados:
            print(f"OK       {nome}")
            continue
        print(f"SUSPEITO {nome}")
        vistos = set()
        for linha, ref, tabela, col in achados:
            if (ref, col) in vistos:
                continue
            vistos.add((ref, col))
            print(f"           linha ~{linha}: {ref} — `{tabela}` nao tem coluna `{col}`")
            total += 1
    print()
    if total:
        print(f"!! {total} referencia(s) a conferir A MAO antes de mandar o dono rodar.")
        print("   (leitura de texto, nao parser: pode ser alias de subconsulta)")
        return 1
    print("Nenhuma coluna inexistente nas migrations pendentes.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
