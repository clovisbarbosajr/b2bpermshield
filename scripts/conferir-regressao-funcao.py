# -*- coding: utf-8 -*-
"""As migrations PENDENTES redefinem funcao que ja foi corrigida?

`CREATE OR REPLACE FUNCTION` sobrescreve o corpo inteiro. Se eu escrevi a versao
pendente a partir de uma copia ANTIGA, rodar ela DESFAZ a correcao que ja esta
no ar — sem erro, sem aviso, e a conferencia final diria 'OK' porque a funcao
existe.

Para cada funcao redefinida pelas 7 pendentes, mostra qual migration a definiu
por ultimo antes, e o que muda de uma para a outra.
"""
import io, os, re, glob, difflib

DIR = 'supabase/migrations'
CORTE = '20260825320000'


def defs_do_arquivo(caminho):
    """nome -> corpo completo do CREATE OR REPLACE FUNCTION."""
    sql = io.open(caminho, encoding='utf-8', errors='replace').read()
    codigo = '\n'.join(l for l in sql.split('\n') if not l.lstrip().startswith('--'))
    out = {}
    for m in re.finditer(
            r'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?(\w+)\s*\(', codigo, flags=re.I):
        nome = m.group(1)
        abre = codigo.find('$$', m.end())
        if abre == -1:
            continue
        fecha = codigo.find('$$', abre + 2)
        if fecha == -1:
            continue
        out[nome] = codigo[m.start():fecha + 2]
    return out


todos = sorted(glob.glob(os.path.join(DIR, '*.sql')))
pendentes = [c for c in todos if os.path.basename(c)[:14] >= CORTE]
anteriores = [c for c in todos if os.path.basename(c)[:14] < CORTE]

# Ultima definicao de cada funcao ANTES do corte.
ultima_antes = {}
for c in anteriores:
    for nome, corpo in defs_do_arquivo(c).items():
        ultima_antes[nome] = (os.path.basename(c), corpo)

print("Funcoes redefinidas pelas 7 pendentes:\n")
achou = False
for c in pendentes:
    nome_arq = os.path.basename(c)
    for nome, corpo_novo in defs_do_arquivo(c).items():
        achou = True
        if nome not in ultima_antes:
            print(f"  NOVA      {nome}  ({nome_arq})")
            continue
        arq_antes, corpo_antes = ultima_antes[nome]
        if corpo_antes.strip() == corpo_novo.strip():
            print(f"  IDENTICA  {nome}  ({nome_arq}) — nao muda nada, so reaplica")
            continue
        print(f"  REDEFINE  {nome}")
        print(f"            antes: {arq_antes}")
        print(f"            agora: {nome_arq}")
        d = list(difflib.unified_diff(
            corpo_antes.strip().split('\n'), corpo_novo.strip().split('\n'),
            lineterm='', n=0))
        removidas = [l for l in d if l.startswith('-') and not l.startswith('---')]
        add = [l for l in d if l.startswith('+') and not l.startswith('+++')]
        print(f"            {len(removidas)} linha(s) removida(s), {len(add)} acrescentada(s)")
        for l in removidas[:8]:
            print("              " + l[:110])
        if len(removidas) > 8:
            print(f"              ... mais {len(removidas) - 8}")
        print()

if not achou:
    print("  (nenhuma)")
