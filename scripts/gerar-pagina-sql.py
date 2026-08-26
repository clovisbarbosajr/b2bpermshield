# -*- coding: utf-8 -*-
"""Gera a PAGINA de execucao dos SQL pendentes (a que abre na lateral).

    python scripts/gerar-pagina-sql.py [destino.html]

Irma do `gerar-runbook.py`, para o mesmo conteudo em outro formato: aqui e so o
que se COPIA — sem consulta de "o que vai mudar", que o dono pediu para tirar.

Mesma disciplina do outro: le o SQL dos arquivos de migration e CONFERE no fim
que o que escreveu bate byte a byte. Sai com codigo 1 se nao bater.
"""
import io, os, re, sys, html, json

DIR = 'supabase/migrations'
DESTINO = sys.argv[1] if len(sys.argv) > 1 else 'C:/Users/clovi/Desktop/PermShield-SQL.html'

PASSOS = [
    ("20260825320000_estoque_por_variante.sql",
     "Estoque de tamanho/cor passa a dar baixa",
     "Rode fora de horário de pico — trava a tabela de variantes durante o preenchimento e a loja espera alguns segundos."),
    ("20260825330000_item_produto_valido.sql",
     "Item de pedido recusa produto desativado ou privado", None),
    ("20260825340000_log_auditoria_nao_forjavel.sql",
     "Log de auditoria deixa de ser forjável", None),
    ("20260825350000_trava_colunas_item.sql",
     "Item não nasce mais marcado como enviado", None),
    ("20260825360000_preco_exige_conta_liberada.sql",
     "Cliente suspenso para de ler sua régua de preço", None),
    ("20260825370000_view_as_diz_a_verdade.sql",
     "O “ver como” para de mentir", None),
    ("20260825380000_cupom_consumo_no_servidor.sql",
     "Limite de uso do cupom deixa de ser honra", None),
    ("20260825390000_pedido_minimo_no_servidor.sql",
     "Pedido mínimo deixa de ser só do navegador",
     "Depois de rodar, teste os dois lados: carrinho abaixo do mínimo tem que ser recusado, e carrinho acima tem que passar."),
]

CONFERENCIA = """WITH esperado(item, tipo) AS (
  VALUES
    ('a_trg_lock_item_cols',        'gatilho_itens'),
    ('trg_item_produto_valido',     'gatilho_itens'),
    ('trg_pedido_minimo',           'gatilho_itens'),
    ('trg_cupom_consome',           'gatilho_pedidos'),
    ('trg_cupom_devolve_status',    'gatilho_pedidos'),
    ('trg_cupom_devolve_delete',    'gatilho_pedidos'),
    ('trg_activity_log_identidade', 'gatilho_log'),
    ('conta_liberada_de',           'funcao'),
    ('fn_lock_item_cols',           'funcao'),
    ('fn_item_produto_valido',      'funcao'),
    ('fn_cupom_consome',            'funcao'),
    ('fn_pedido_minimo',            'funcao'),
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
ORDER BY situacao, e.tipo, e.item;"""

EDGE = ["send-email", "stripe-checkout", "register-customer", "company-member", "b2bwave-sync"]


def corpo_executavel(sql):
    i = sql.index('\nBEGIN;')
    j = sql.rindex('COMMIT;') + len('COMMIT;')
    return sql[i + 1:j].strip()


blocos = []
for arq, titulo, aviso in PASSOS:
    sql = io.open(os.path.join(DIR, arq), encoding='utf-8').read().replace('\r\n', '\n')
    blocos.append(dict(arq=arq, titulo=titulo, aviso=aviso, sql=corpo_executavel(sql)))

TOTAL = len(blocos) + 1   # + a conferência final


def card(n, titulo, arq, aviso, sql, tipo="sql"):
    av = (f'<p class="aviso">{html.escape(aviso)}</p>' if aviso else '')
    sub = (f'<p class="arq">{html.escape(arq)}</p>' if arq else '')
    return f'''<section class="passo" id="p{n}">
  <header class="cab">
    <label class="marca">
      <input type="checkbox" class="feito" data-n="{n}" aria-label="Marcar passo {n} como feito">
      <span class="num"><b>{n}</b></span>
    </label>
    <div class="tit">
      <h2>{html.escape(titulo)}</h2>
      {sub}
    </div>
  </header>
  {av}
  <div class="cod">
    <button class="copiar" type="button">Copiar</button>
    <pre><code>{html.escape(sql)}</code></pre>
  </div>
</section>'''


cards = []
for i, b in enumerate(blocos, start=1):
    cards.append(card(i, b["titulo"], b["arq"], b["aviso"], b["sql"]))
cards.append(card(TOTAL, "Conferência final", None,
                  "Me mande o resultado desta. Tudo tem que voltar OK.", CONFERENCIA))

edge_html = "".join(f'<li><code>{html.escape(e)}</code></li>' for e in EDGE)

PAGINA = f'''<title>SQL do PermShield</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
  :root {{
    --ground:#f4f6f9; --card:#ffffff; --ink:#161922; --ink2:#59616f;
    --linha:#dde2ea; --acento:#33397f; --acento-sv:#eceefb;
    --aviso:#8a5a00; --aviso-bg:#fdf4e3; --aviso-br:#e8d5ab;
    --feito:#1c6f47; --cod-bg:#fbfcfd;
  }}
  @media (prefers-color-scheme: dark) {{
    :root:not([data-theme="light"]) {{
      --ground:#12141a; --card:#191c24; --ink:#e8ebf1; --ink2:#98a1b2;
      --linha:#2a2f3b; --acento:#a3aaf5; --acento-sv:#232840;
      --aviso:#e0b45f; --aviso-bg:#2a2416; --aviso-br:#4a3f22;
      --feito:#5ec894; --cod-bg:#14171e;
    }}
  }}
  :root[data-theme="dark"] {{
    --ground:#12141a; --card:#191c24; --ink:#e8ebf1; --ink2:#98a1b2;
    --linha:#2a2f3b; --acento:#a3aaf5; --acento-sv:#232840;
    --aviso:#e0b45f; --aviso-bg:#2a2416; --aviso-br:#4a3f22;
    --feito:#5ec894; --cod-bg:#14171e;
  }}
  * {{ box-sizing:border-box; }}
  body {{
    margin:0; padding:2rem 1.25rem 5rem; background:var(--ground); color:var(--ink);
    font-family:"Archivo",system-ui,-apple-system,"Segoe UI",sans-serif;
    font-size:16px; line-height:1.55; -webkit-font-smoothing:antialiased;
  }}
  .env {{ max-width:60rem; margin:0 auto; display:flex; flex-direction:column; gap:1.25rem; }}
  .topo h1 {{ font-size:1.6rem; font-weight:700; letter-spacing:-.02em; margin:0 0 .35rem; text-wrap:balance; }}
  .topo p {{ margin:0; color:var(--ink2); font-size:.95rem; max-width:52ch; }}
  .barra {{
    position:sticky; top:0; z-index:5; margin:0 -1.25rem; padding:.7rem 1.25rem;
    background:color-mix(in srgb, var(--ground) 88%, transparent);
    backdrop-filter:blur(8px); border-bottom:1px solid var(--linha);
    display:flex; align-items:center; gap:.85rem; font-size:.85rem;
  }}
  .barra strong {{ font-variant-numeric:tabular-nums; color:var(--acento); }}
  .trilho {{ flex:1; height:5px; border-radius:99px; background:var(--linha); overflow:hidden; }}
  .trilho i {{ display:block; height:100%; width:0; background:var(--feito); transition:width .25s ease; }}
  .parar {{
    border:1px solid var(--aviso-br); background:var(--aviso-bg); color:var(--aviso);
    border-radius:8px; padding:.7rem .9rem; font-size:.9rem; font-weight:600;
  }}
  .passo {{
    background:var(--card); border:1px solid var(--linha); border-radius:10px;
    padding:1rem 1.1rem 1.1rem; display:flex; flex-direction:column; gap:.75rem;
  }}
  .passo.ok {{ border-color:color-mix(in srgb, var(--feito) 45%, var(--linha)); }}
  .cab {{ display:flex; gap:.85rem; align-items:flex-start; }}
  .marca {{ display:flex; align-items:center; cursor:pointer; flex:0 0 auto; }}
  .marca input {{ position:absolute; opacity:0; width:1px; height:1px; }}
  .num {{
    display:grid; place-items:center; width:2.1rem; height:2.1rem; border-radius:7px;
    background:var(--acento-sv); color:var(--acento); font-weight:700;
    font-variant-numeric:tabular-nums; font-size:.95rem; border:1px solid transparent;
    transition:background .15s, color .15s;
  }}
  .marca input:focus-visible + .num {{ outline:2px solid var(--acento); outline-offset:2px; }}
  .num b {{ font-weight:700; }}
  .passo.ok .num {{ background:var(--feito); color:#fff; font-size:1.05rem; }}
  /* O digito e um ELEMENTO (<b>), nao no texto solto: `> *` nao esconde no de
     texto, e marcado apareceria "3✓" em vez do visto. */
  .passo.ok .num b {{ display:none; }}
  .passo.ok .num::after {{ content:"✓"; }}
  .tit h2 {{ margin:0; font-size:1.05rem; font-weight:600; letter-spacing:-.01em; text-wrap:balance; }}
  .arq {{ margin:.2rem 0 0; font-family:"JetBrains Mono",ui-monospace,monospace; font-size:.75rem; color:var(--ink2); word-break:break-all; }}
  .aviso {{
    margin:0; padding:.6rem .8rem; border-radius:7px; font-size:.87rem;
    background:var(--aviso-bg); border:1px solid var(--aviso-br); color:var(--aviso);
  }}
  .cod {{ position:relative; }}
  .cod pre {{
    margin:0; padding:.9rem 1rem; max-height:22rem; overflow:auto;
    background:var(--cod-bg); border:1px solid var(--linha); border-radius:8px;
  }}
  .cod code {{ font-family:"JetBrains Mono",ui-monospace,monospace; font-size:.76rem; line-height:1.6; white-space:pre; color:var(--ink); }}
  .copiar {{
    position:absolute; top:.5rem; right:.5rem; z-index:2;
    font-family:inherit; font-size:.78rem; font-weight:600; cursor:pointer;
    padding:.35rem .7rem; border-radius:6px; color:var(--acento);
    background:var(--card); border:1px solid var(--linha);
  }}
  .copiar:hover {{ background:var(--acento-sv); }}
  .copiar.ok {{ color:#fff; background:var(--feito); border-color:var(--feito); }}
  .fim {{ background:var(--card); border:1px solid var(--linha); border-radius:10px; padding:1rem 1.1rem; }}
  .fim h2 {{ margin:0 0 .5rem; font-size:1.05rem; font-weight:600; }}
  .fim ol {{ margin:0; padding-left:1.2rem; }}
  .fim li {{ margin:.35rem 0; }}
  .fim ul {{ margin:.35rem 0 0; padding-left:1.1rem; }}
  .fim code {{ font-family:"JetBrains Mono",ui-monospace,monospace; font-size:.8rem; }}
  @media (prefers-reduced-motion:reduce) {{ * {{ transition:none !important; }} }}
</style>

<div class="env">
  <div class="topo">
    <h1>SQL pendente — rodar no editor do Lovable</h1>
    <p>Oito blocos, um de cada vez, na ordem. Marque o número ao terminar cada um; a marcação fica salva se você fechar a página.</p>
  </div>

  <div class="barra">
    <strong id="cont">0/{TOTAL}</strong>
    <span class="trilho"><i id="trilho"></i></span>
  </div>

  <p class="parar">Se qualquer bloco der erro, pare e me mande o erro. Não pule para o próximo.</p>

  {"".join(cards)}

  <div class="fim">
    <h2>Depois dos blocos</h2>
    <ol>
      <li>Publish.</li>
      <li>Pedir no chat do Lovable o deploy destas edge functions — push no GitHub <strong>não</strong> publica edge function:
        <ul>{edge_html}</ul>
      </li>
      <li>Abrir <strong>B2B Wave Sync</strong> no admin e clicar em <strong>Comparar Pedidos</strong> e <strong>Comparar Catálogo</strong>. Me mandar os dois resultados.</li>
    </ol>
  </div>
</div>

<script>
  const CHAVE = "permshield-sql-8";
  const total = {TOTAL};
  const feitos = new Set(JSON.parse(localStorage.getItem(CHAVE) || "[]"));

  function pintar() {{
    document.querySelectorAll(".feito").forEach(cx => {{
      const n = Number(cx.dataset.n);
      cx.checked = feitos.has(n);
      cx.closest(".passo").classList.toggle("ok", cx.checked);
    }});
    document.getElementById("cont").textContent = feitos.size + "/" + total;
    document.getElementById("trilho").style.width = (feitos.size / total * 100) + "%";
  }}

  document.querySelectorAll(".feito").forEach(cx => {{
    cx.addEventListener("change", () => {{
      const n = Number(cx.dataset.n);
      cx.checked ? feitos.add(n) : feitos.delete(n);
      localStorage.setItem(CHAVE, JSON.stringify([...feitos]));
      pintar();
    }});
  }});

  document.querySelectorAll(".copiar").forEach(bt => {{
    bt.addEventListener("click", async () => {{
      const txt = bt.parentElement.querySelector("code").textContent;
      try {{
        await navigator.clipboard.writeText(txt);
        bt.textContent = "Copiado";
      }} catch {{
        // Sem permissão de área de transferência: seleciona para copiar à mão,
        // em vez de dizer "copiado" sem ter copiado.
        const r = document.createRange();
        r.selectNodeContents(bt.parentElement.querySelector("code"));
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        bt.textContent = "Selecionado — Ctrl+C";
      }}
      bt.classList.add("ok");
      setTimeout(() => {{ bt.textContent = "Copiar"; bt.classList.remove("ok"); }}, 1800);
    }});
  }});

  pintar();
</script>
'''

io.open(DESTINO, 'w', encoding='utf-8', newline='\n').write(PAGINA)

# ---- CONFERE: cada SQL escrito bate com o arquivo. ----
saida = io.open(DESTINO, encoding='utf-8').read()
ruins = [b["arq"] for b in blocos if html.escape(b["sql"]) not in saida]
if ruins:
    print("FALHOU — SQL escrito nao bate com a migration:", file=sys.stderr)
    for r in ruins:
        print("  -", r, file=sys.stderr)
    sys.exit(1)

print(DESTINO)
print(f"{len(blocos)} blocos + conferencia — todos conferidos contra {DIR}/")
