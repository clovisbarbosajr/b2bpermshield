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
    ("20260826010000_supressao_nao_encurta.sql",
     "Um lote para de desligar a proteção do outro", None),
    ("20260826080000_supressao_vale_com_lote_vivo.sql",
     "A proteção passa a valer enquanto o lote estiver rodando",
     "Esta e a de cima andam JUNTAS: uma escreve a contagem, esta faz o sistema olhar para ela. Sozinha, nenhuma das duas resolve."),
    ("20260826020000_cliente_nao_edita_dinheiro.sql",
     "Cliente para de editar o próprio pedido mínimo", None),
    ("20260826030000_cupom_consumo_atomico.sql",
     "Cupom de uso único deixa de ser ilimitado",
     "Depois de rodar, teste os dois lados: pedido com cupom válido tem que aplicar o desconto; um segundo pedido com o mesmo cupom de uso único tem que entrar SEM desconto."),
    ("20260826040000_opcao_de_frete_e_pagamento_valida.sql",
     "Condição de pagamento que você não concedeu para de ser escolhível",
     "Teste os dois lados: pedido com opção pública tem que passar; opção privada não atribuída tem que ser recusada."),
    ("20260826050000_cupom_nao_e_catalogo_publico.sql",
     "A lista de cupons deixa de ser legível por qualquer conta",
     "Depois desta, o cupom só volta a funcionar quando o site for publicado. Por isso as três etapas — SQL, deploy e publish — têm que ser na mesma sessão."),
    ("20260826060000_revoga_claim_customer_record.sql",
     "Função de adoção de ficha sai do alcance do cliente", None),
    ("20260826070000_dedupe_marca_o_historico.sql",
     "O registro antigo ganha a marca de origem",
     "Me mande o retorno da consulta de conferência que está dentro deste arquivo: ela mostra quantas linhas foram marcadas e confirma que nenhuma do portal foi marcada por engano."),
]

CONFERENCIA = """WITH esperado(o_que_e, item, tipo) AS (
  VALUES
    ('recusa frete/pagamento nao atribuido', 'a_trg_pedido_opcoes_validas', 'gatilho'),
    ('idem (a funcao)',                      'fn_pedido_opcoes_validas',    'funcao'),
    ('consulta fechada de cupom',            'cupom_por_codigo',            'funcao'),
    ('acelera o "ja avisei este pedido?"',   'notification_log_dedupe_idx', 'indice')
)
SELECT e.o_que_e, e.item,
  CASE
    WHEN e.tipo = 'gatilho' AND EXISTS (
      SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.pedidos'::regclass
        AND NOT t.tgisinternal AND t.tgname = e.item) THEN 'OK'
    WHEN e.tipo = 'funcao' AND EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = e.item) THEN 'OK'
    WHEN e.tipo = 'indice' AND EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
        AND tablename = 'notification_log' AND indexname = e.item) THEN 'OK'
    ELSE 'FALTA'
  END
FROM esperado e
UNION ALL
SELECT 'lista de cupons fechada (0 = fechada)', 'politica antiga',
       count(*)::text FROM pg_policies
 WHERE schemaname='public' AND tablename='coupons'
   AND policyname='Authenticated read active coupons'
UNION ALL
SELECT 'colunas de dinheiro trancadas (4 = ok)', 'trava do cliente',
       -- `~` com barra-s-asterisco, nao `LIKE` com espaco literal: as linhas sao
       -- ALINHADAS com varios espacos antes do `:=`, entao dois dos quatro
       -- padroes com LIKE nunca casavam e a conferencia dizia 2 com tudo certo.
       -- Verificador que subconta assusta a toa e, na proxima, e ignorado.
       (SELECT count(*)::text FROM regexp_split_to_table(pg_get_functiondef(
          'public.fn_lock_privileged_cliente_cols()'::regprocedure), chr(10)) l
         WHERE l ~ 'NEW\.(minimum_order_value|pais|discount|admin_comments)\s*:=')
UNION ALL
SELECT 'cupom consumido no mesmo comando (1 = ok)', 'consumo atomico',
       (SELECT count(*)::text FROM regexp_split_to_table(pg_get_functiondef(
          'public.fn_pedido_total_appside()'::regprocedure), chr(10)) l
         WHERE l LIKE '%UPDATE public.coupons%')
UNION ALL
SELECT 'supressao olha lote vivo (1 = ok)', 'trava de lote',
       (SELECT count(*)::text FROM regexp_split_to_table(pg_get_functiondef(
          'public.fn_order_status_notify()'::regprocedure), chr(10)) l
         WHERE l LIKE '%120 minutes%')
UNION ALL
SELECT 'gatilhos de notificacao (D+D = desligados)', 'devem seguir desligados',
       COALESCE((SELECT string_agg(tgenabled::text, '+' ORDER BY tgname) FROM pg_trigger
                  WHERE tgname IN ('trg_low_stock_notify','trg_order_status_notify')
                    AND NOT tgisinternal), 'nao existem');"""

PRE_CHECK = """-- Diz, bloco a bloco, o que JA esta no banco. Rode esta ANTES de tudo.
-- APLICADO = pode pular esse bloco.  FALTA = precisa rodar.
WITH alvo(passo, bloco, tipo, item) AS (
  VALUES
    (1, 'Lote nao desliga protecao do outro', 'campo_n',   'suppress_order_notify'),
    (2, 'Protecao vale com lote vivo',        'corpo_fn',  'fn_order_status_notify'),
    (3, 'Cliente nao edita dinheiro',         'corpo_fn2', 'fn_lock_privileged_cliente_cols'),
    (4, 'Cupom sem corrida',                  'corpo_fn3', 'fn_pedido_total_appside'),
    (5, 'Frete/pagamento validos',            'gatilho',   'a_trg_pedido_opcoes_validas'),
    (6, 'Cupom nao e catalogo',               'funcao',    'cupom_por_codigo'),
    (7, 'claim_customer_record revogada',     'sem_grant', 'claim_customer_record'),
    (8, 'Historico marcado',                  'indice',    'notification_log_dedupe_idx')
)
SELECT a.passo, a.bloco,
  CASE
    WHEN a.tipo = 'campo_n' AND EXISTS (
      SELECT 1 FROM public.sync_state
       WHERE key = a.item AND value ? 'desde') THEN 'APLICADO'
    WHEN a.tipo = 'corpo_fn' AND pg_get_functiondef(
      'public.fn_order_status_notify()'::regprocedure) LIKE '%120 minutes%' THEN 'APLICADO'
    WHEN a.tipo = 'corpo_fn2' AND pg_get_functiondef(
      'public.fn_lock_privileged_cliente_cols()'::regprocedure)
      LIKE '%minimum_order_value%' THEN 'APLICADO'
    WHEN a.tipo = 'corpo_fn3' AND pg_get_functiondef(
      'public.fn_pedido_total_appside()'::regprocedure)
      LIKE '%UPDATE public.coupons%' THEN 'APLICADO'
    WHEN a.tipo = 'gatilho' AND EXISTS (
      SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.pedidos'::regclass
        AND NOT t.tgisinternal AND t.tgname = a.item) THEN 'APLICADO'
    WHEN a.tipo = 'funcao' AND EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = a.item) THEN 'APLICADO'
    -- Revogada = ninguem alem do dono tem EXECUTE.
    WHEN a.tipo = 'sem_grant' AND NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = a.item
         AND p.proacl::text LIKE '%authenticated=X%') THEN 'APLICADO'
    WHEN a.tipo = 'indice' AND EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
        AND tablename = 'notification_log' AND indexname = a.item) THEN 'APLICADO'
    ELSE 'FALTA'
  END AS situacao
FROM alvo a
ORDER BY a.passo;"""

EDGE = ["send-email", "stripe-checkout", "register-customer", "company-member"]


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
    # O passo 0 e conferencia, nao trabalho: fica fora da contagem, senao o
    # progresso diria 1/10 antes de o dono ter rodado nada.
    fora = ' data-fora="1"' if n == 0 else ''
    rot = "0" if n == 0 else str(n)
    return f'''<section class="passo" id="p{n}">
  <header class="cab">
    <label class="marca">
      <input type="checkbox" class="feito" data-n="{n}" aria-label="Marcar passo {n} como feito"{fora}>
      <span class="num"><b>{rot}</b></span>
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


cards = [card(0, "Antes de tudo: o que já está aplicado?", None,
              "Rode esta primeiro. O que voltar APLICADO você pula; o que voltar FALTA você roda. "
              "Nenhum dos 8 blocos foi rodado ainda até onde eu sei — esta consulta confirma no banco, "
              "em vez de você confiar na minha memória.", PRE_CHECK)]
for i, b in enumerate(blocos, start=1):
    cards.append(card(i, b["titulo"], b["arq"], b["aviso"], b["sql"]))
cards.append(card(TOTAL, "Conferência final", None,
                  "Me mande o resultado desta. Tudo tem que voltar OK.", CONFERENCIA))

edge_html = "".join(f'<li><code>{html.escape(e)}</code></li>' for e in EDGE)

PAGINA = f'''<meta charset="utf-8">
<title>SQL do PermShield</title>
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
    <h1>SQL de 26/ago — notificação e preço</h1>
    <p>Comece pelo bloco <b>0</b>: ele diz o que já está no banco e o que falta. Depois, os oito, um de cada vez, na ordem. Marque o número ao terminar; a marcação fica salva se você fechar a página.</p>
    <p><b>As três etapas — SQL, deploy das edge functions e publish — têm que ser na mesma sessão.</b> Entre o bloco 6 e o publish, o cupom fica sem funcionar no portal.</p>
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
  const CHAVE = "permshield-sql-26ago";
  const total = {TOTAL};
  const feitos = new Set(JSON.parse(localStorage.getItem(CHAVE) || "[]"));

  function pintar() {{
    document.querySelectorAll(".feito").forEach(cx => {{
      const n = Number(cx.dataset.n);
      cx.checked = feitos.has(n);
      cx.closest(".passo").classList.toggle("ok", cx.checked);
    }});
    // O passo 0 nao conta.
    const n = [...feitos].filter(x => x > 0).length;
    document.getElementById("cont").textContent = n + "/" + total;
    document.getElementById("trilho").style.width = (n / total * 100) + "%";
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
