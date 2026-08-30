import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { paginasVisiveis, paginaValida } from "@/lib/paginacao";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { descendantIds } from "@/lib/categoryTree";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Search, Image as ImageIcon, Eye, X, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useActivityLog } from "@/hooks/useActivityLog";
import { useAuth } from "@/contexts/AuthContext";
import { categoryTreeOptions } from "@/lib/categoryTree";
import { gravarComToken } from "@/lib/gravarComToken";

const PAGE_SIZE = 25;

const statusOptions = [
  { value: "disponivel", label: "Available" },
  { value: "estoque_limitado", label: "Limited Stock" },
  { value: "pre_venda", label: "Pre-order" },
  { value: "indisponivel", label: "Not available" },
  { value: "esgotado", label: "Sold Out" },
];

type Produto = {
  id: string; nome: string; sku: string; preco: number; ativo: boolean;
  estoque_total: number; estoque_reservado: number; categoria_id: string | null;
  imagem_url: string | null; status_produto: string | null; preco_msrp: number | null;
  custo: number | null; created_at: string; updated_at: string;
  // O `select("*")` sempre trouxe esta coluna; faltava DECLARA-LA para os dois
  // handlers da lista poderem usar o mesmo bloqueio otimista da ficha.
  admin_rev: number;
};
type Categoria = { id: string; nome: string; parent_id: string | null; ordem?: number | null };
type Brand = { id: string; nome: string };

const emptyFilters = {
  name: "", code: "", category: "", isActive: "Active", status: "",
  brand: "", privacyGroup: "", allowBackorder: "",
};

const AdminProdutos = () => {
  const navigate = useNavigate();
  const { log } = useActivityLog();
  // Usado so para RECUSAR o delete quando a tela nao consegue contar a cascata —
  // ver o comentario em `handleDelete`. Nao esconde nem libera nada alem disso.
  const { role } = useAuth();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [privacyGroups, setPrivacyGroups] = useState<any[]>([]);
  const [filters, setFilters] = useState({ ...emptyFilters });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  // O `catch` ja toastava, mas o toast do sonner dura 6 s e a TABELA continuava
  // afirmando "No products found" para sempre. Quem chega na tela dez segundos
  // depois — ou com a aba em segundo plano — le catalogo vazio e acredita.
  // `produtos.sku` deixou de ser UNIQUE (decisao do clone, `20260708140000`),
  // entao recadastrar duplica sem nenhuma barreira.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Linha com gravacao em voo. Os DOIS selects da mesma linha mexem na mesma
  // ficha, e o `admin_rev` do segundo vem da closure do render em que ele nasceu.
  // O admin marcava "Sold Out" e, sem esperar, mudava Active da mesma linha
  // ("esgotou, desativa"): o segundo carregava o token de ANTES da primeira
  // gravacao, `gravarComToken` filtrava por ele, zero linhas — e a tela acusava
  // "Someone else changed this product", mandando recarregar. Ninguem tinha
  // mexido: era ele mesmo. E a segunda mudanca era descartada em silencio.
  //
  // Travar os selects da linha e mais honesto que enfileirar: o admin ve que a
  // primeira mudanca ainda esta indo. `setState` antes do primeiro `await` ja
  // esta comitado quando o proximo evento discreto e despachado.
  //
  // `Set`, E NAO UM SLOT UNICO. Com um `string | null`, clicar na linha B com a
  // gravacao da linha A ainda em voo sobrescrevia o slot e DESTRAVAVA a linha A
  // no meio do caminho — reabrindo exatamente o falso conflito que esta trava veio
  // fechar. Medido em execucao: t=50ms linha A travada, t=60ms destravada com a
  // gravacao de A ainda no ar; o clique seguinte em A lia o `admin_rev` velho e a
  // tela acusava "Someone else changed this product".
  const [salvando, setSalvando] = useState<Set<string>>(new Set());
  // Price lists for columns
  const [priceLists, setPriceLists] = useState<any[]>([]);
  // Map produto_id -> Set de privacy_group_id (para o filtro de privacy group)
  const [acessoMap, setAcessoMap] = useState<Record<string, Set<string>>>({});

  useEffect(() => {
    const fetchAll = async () => {
      try {
        // `fetchAllRows`: o PostgREST corta em 1000 SEM erro. `produto_acesso` tem
        // uma linha por produto×grupo e estoura antes do catálogo — com o mapa
        // truncado, o filtro de privacidade escondia produto válido.
        const [p, c, b, pg, pl, pa] = await Promise.all([
          // Ordena por data de cadastro (mais recente primeiro) para espelhar o B2BWave (clone).
          fetchAllRows<Produto>((f, t) => supabase.from("produtos").select("*").order("created_at", { ascending: false }).order("id", { ascending: true }).range(f, t) as any),
          fetchAllRows<any>((f, t) => supabase.from("categorias").select("id, nome, parent_id, ordem").order("nome").order("id", { ascending: true }).range(f, t) as any),
          fetchAllRows<any>((f, t) => supabase.from("brands").select("id, nome").order("nome").order("id", { ascending: true }).range(f, t) as any),
          fetchAllRows<any>((f, t) => supabase.from("privacy_groups").select("id, nome").eq("ativo", true).order("id", { ascending: true }).range(f, t) as any),
          fetchAllRows<any>((f, t) => supabase.from("tabelas_preco").select("id, nome").eq("ativo", true).order("nome").order("id", { ascending: true }).range(f, t) as any),
          // Traz o ID do grupo, não só o nome — ver o mapa abaixo.
          fetchAllRows<any>((f, t) => supabase.from("produto_acesso").select("id, produto_id, privacy_group_id, grupo_nome").order("id", { ascending: true }).range(f, t) as any),
        ]);
        setLoadError(null);
        setProdutos(p);
        setCategorias(c);
        setBrands(b);
        setPrivacyGroups(pg);
        setPriceLists(pl);
        // O filtro compara com o **id** do grupo (o `<SelectItem value={g.id}>`),
        // mas o mapa era montado só com `grupo_nome` — `Set{"Dealers"}.has("<uuid>")`
        // nunca casava e escolher qualquer grupo dava "No products found".
        // Agora indexa pelos DOIS: `privacy_group_id` (linhas novas) e o nome
        // resolvido pra id (linhas antigas, gravadas antes da coluna existir).
        const idPorNome = new Map<string, string>(pg.map((g: any) => [String(g.nome).toLowerCase(), g.id]));
        const map: Record<string, Set<string>> = {};
        for (const row of pa) {
          const gid = row.privacy_group_id ?? (row.grupo_nome ? idPorNome.get(String(row.grupo_nome).toLowerCase()) : null);
          if (!gid) continue;
          (map[row.produto_id] ??= new Set()).add(gid);
        }
        setAcessoMap(map);
      } catch (e: any) {
        // Antes o erro era engolido e a tela dizia "No products found", igual a
        // catálogo vazio — o admin concluía que tinha perdido os produtos.
        console.error(e);
        setLoadError(e?.message ?? String(e));
        toast.error("Could not load products. Please try again.");
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const setFilter = (key: string, val: string) => {
    setFilters(prev => ({ ...prev, [key]: val }));
    setPage(1);
  };

  const clearFilters = () => { setFilters({ ...emptyFilters }); setPage(1); };

  const getCategoryName = (id: string | null) => {
    if (!id) return "—";
    return categorias.find(c => c.id === id)?.nome ?? "—";
  };

  const filtered = produtos.filter(p => {
    if (filters.name && !p.nome.toLowerCase().includes(filters.name.toLowerCase())) return false;
    if (filters.code && !(p.sku ?? "").toLowerCase().includes(filters.code.toLowerCase())) return false;
    // Inclui as SUBCATEGORIAS. O dropdown mostra a árvore inteira, então escolher
    // uma categoria-pai comparando exato devolvia quase nada — enquanto o portal,
    // na mesma escolha, mostra dezenas (`Catalogo.tsx` usa `descendantIds`).
    if (filters.category) {
      const alvo = new Set(descendantIds(categorias as any, filters.category));
      if (!p.categoria_id || !alvo.has(p.categoria_id)) return false;
    }
    if (filters.isActive === "Active" && !p.ativo) return false;
    if (filters.isActive === "Inactive" && p.ativo) return false;
    if (filters.status && p.status_produto !== filters.status) return false;
    if (filters.brand && (p as any).brand_id !== filters.brand) return false;
    if (filters.privacyGroup && !acessoMap[p.id]?.has(filters.privacyGroup)) return false;
    if (filters.allowBackorder === "yes" && !(p as any).permitir_backorder) return false;
    if (filters.allowBackorder === "no" && (p as any).permitir_backorder) return false;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  // BECO SEM SAIDA: `page` nao era limitado depois de uma escrita. Com 26 produtos
  // (`page = 2`), apagar a unica linha da pagina 2 deixava `totalPages = 1` — e a
  // barra inteira esta sob `totalPages > 1`, entao ela DESMONTAVA. `paginated`
  // virava `[]` e a tela dizia "No products found" sem nenhum botao de voltar.
  // Sair de la exigia F5.
  //
  // O mesmo beco pelo outro caminho: o filtro nasce em "Active", entao desativar a
  // ultima linha da ultima pagina tem exatamente o mesmo efeito.
  //
  // Derivado no render, e nao um `setPage` em efeito: efeito corrige DEPOIS de ter
  // renderizado a tela vazia uma vez, e ainda precisaria de dependencia certa.
  const pageOk = paginaValida(page, totalPages);
  const paginated = filtered.slice((pageOk - 1) * PAGE_SIZE, pageOk * PAGE_SIZE);

  const fmtDate = (d: string) => {
    const dt = new Date(d);
    return `${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}/${dt.getFullYear()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
  };

  // OS DOIS SELECTS DA LISTA GRAVAVAM SEM CONFERIR QUE GRAVARAM, e isso encobria
  // tres defeitos de uma vez:
  //
  // 1. UPDATE barrado por RLS afeta ZERO linhas e devolve `error: null` — a tela
  //    pintava o valor novo sobre uma escrita que nao houve.
  // 2. Sem `admin_rev`, mudar o status pela lista e depois salvar uma ficha que ja
  //    estava aberta DESFAZIA a mudanca da lista, e os dois caminhos diziam
  //    "salvo" (`status_produto` e `ativo` estao no payload do `ProductEdit`).
  // 3. A ficha ja usava `gravarComToken`; a lista, nao. Ter dois caminhos de
  //    escrita para a mesma coluna com garantias diferentes e o que produziu (2).
  //
  // Um so bloco resolve os tres: mesmo bloqueio otimista da ficha, e o `rev` novo
  // volta para o estado local para o proximo clique da mesma linha funcionar.
  const gravarNaLista = async (productId: string, patch: Partial<Produto>) => {
    const produto = produtos.find(p => p.id === productId);
    if (!produto) return;
    // Forma funcional nos dois: dois cliques em linhas diferentes no mesmo tick
    // liam o mesmo `salvando` da closure e um sobrescreveria o outro.
    setSalvando(prev => new Set(prev).add(productId));
    let r: Awaited<ReturnType<typeof gravarComToken>>;
    try {
      r = await gravarComToken(supabase, "produtos", productId, patch, produto.admin_rev);
    } finally {
      // `finally`: se `gravarComToken` lancar, sem isto a linha fica morta ate o F5.
      setSalvando(prev => { const n = new Set(prev); n.delete(productId); return n; });
    }
    if (r.tipo === "conflito") {
      toast.error("Someone else changed this product while this page was open. Nothing was saved — reload to see the current values.");
      return;
    }
    if (r.tipo === "recusado") { toast.error("Not saved: " + r.mensagem); return; }
    if (r.tipo === "incerto") {
      toast.error("Lost connection — it is not possible to tell whether this was saved. Reload and check before trying again.");
      return;
    }
    setProdutos(prev => prev.map(p => p.id === productId ? { ...p, ...patch, admin_rev: r.rev } : p));
  };

  const handleStatusChange = (productId: string, newStatus: string) =>
    gravarNaLista(productId, { status_produto: newStatus });

  const handleActiveChange = (productId: string, newActive: string) =>
    gravarNaLista(productId, { ativo: newActive === "Active" });

  const handleDelete = async (e: React.MouseEvent, productId: string) => {
    e.stopPropagation();
    const produto = produtos.find(p => p.id === productId);

    // O confirm era "Delete this product?" e escondia DOZE cascatas. Nove delas
    // (galeria, arquivos, descontos, preco por cliente, relacionados, opcoes,
    // regras de status, e as DUAS tabelas de privacidade) sao digitadas aqui e o
    // sync do B2BWave nao as devolve — sao irrecuperaveis.
    //
    // O conjunto de fato apagavel e "produto sem venda" (`pedido_itens` e
    // `producao_pedidos` barram o resto por FK), que e exatamente a populacao que
    // o admin apaga por engano de cadastro — e a que tem galeria, desconto e
    // liberacao recem-digitados.
    //
    // Se a contagem falhar, RECUSAR: nao da para avisar do estrago que nao se
    // conseguiu medir. Mesmo molde do `PrivacyGroups.handleDelete`.
    //
    // A LISTA TEM QUE SER COMPLETA. A primeira versao contava seis e o texto do
    // confirm afirmava "Everything above was entered here and cannot be
    // recovered" — um dialogo que jurava, item a item, que nada mais se perdia,
    // enquanto o DELETE levava fichas tecnicas, opcoes, relacionados, regras de
    // status, o preco na regua e o historico de estoque. Cada linha abaixo e um
    // `ON DELETE CASCADE` real, conferido na migration.
    //
    // Nome de tabela LITERAL, e nao `t: string`: o cliente do Supabase e tipado
    // pelo schema, entao `string` derruba o overload e o `tsc` acusa. Digitar
    // errado aqui vira erro de compilacao, que e o ponto.
    type Filha =
      | "produto_imagens" | "produto_arquivos" | "produto_descontos"
      | "produto_precos_cliente" | "produto_acesso" | "produto_cliente_acesso"
      | "produto_variantes" | "produto_opcoes" | "produto_status_regras"
      | "tabela_preco_itens" | "estoque_log" | "produtos_relacionados";
    const contar = (t: Filha) =>
      supabase.from(t).select("produto_id", { count: "exact", head: true }).eq("produto_id", productId);
    // `produtos_relacionados` tem DOIS FKs em cascata: apagar X remove X das fichas
    // de OUTROS produtos tambem, estrago que a contagem por `produto_id` nao
    // enxerga. Fica em chamada propria porque o cliente tipado intersecta as
    // colunas permitidas quando o nome da tabela e uma uniao — `produto_relacionado_id`
    // nao existe nas outras onze e o `tsc` reprova, corretamente.
    const contarInverso = () =>
      supabase.from("produtos_relacionados")
        .select("produto_relacionado_id", { count: "exact", head: true })
        .eq("produto_relacionado_id", productId);
    const [img, arq, desc, precoCli, acesso, acessoCli, variantes, opcoes, regras, regua, estoque, rel, relDe] =
      await Promise.all([
        contar("produto_imagens"), contar("produto_arquivos"), contar("produto_descontos"),
        contar("produto_precos_cliente"), contar("produto_acesso"), contar("produto_cliente_acesso"),
        contar("produto_variantes"), contar("produto_opcoes"), contar("produto_status_regras"),
        contar("tabela_preco_itens"), contar("estoque_log"), contar("produtos_relacionados"),
        contarInverso(),
      ]);
    const contagens = [img, arq, desc, precoCli, acesso, acessoCli, variantes, opcoes, regras, regua, estoque, rel, relDe];
    const erro = contagens.find(c => c.error)?.error;
    if (erro) {
      toast.error("Could not check what depends on this product — nothing was deleted: " + erro.message);
      return;
    }

    // A GUARDA ACIMA FALHA ABERTA, e por isso ela nao basta sozinha.
    //
    // Contagem barrada por RLS NAO e erro: o PostgREST devolve `count: 0` com
    // `error: null`. E `produto_status_regras` e `produto_acesso` tem policy SO de
    // admin (`20260318202244:147` e `:157`) — nao ha policy de manager.
    //
    // Mas o MANAGER alcanca este delete: a rota exige so `view_products`
    // (`App.tsx:191`), o botao da lixeira nao checa papel, e
    // `Managers manage produtos` (`20260619003000:67-68`) da o DELETE.
    //
    // Resultado: onde o admin le "2 privacy group permission(s), 3 status
    // rule(s)", o manager le "0" e "0" — e confirma sob um texto que promete
    // completude ("Everything above was entered here and cannot be recovered").
    // O CASCADE apaga as cinco linhas assim mesmo. Perda silenciosa.
    //
    // Nao da para contar o que a RLS esconde, entao a tela recusa a operacao que
    // nao consegue descrever com honestidade. Isto NAO mexe em RLS nem afrouxa
    // permissao: e a tela deixando de prometer o que nao pode cumprir. Liberar o
    // delete para manager, se for o desejado, e decisao do dono — esta na batelada.
    if (role !== "admin") {
      toast.error(
        "Only administrators can delete products. Some of the records that would be deleted " +
        "along with it are not visible to your role, so this screen cannot tell you what would be lost."
      );
      return;
    }

    if (!confirm(
      `Delete "${produto?.nome ?? productId}"?\n\n` +
      `This permanently deletes, together with the product:\n` +
      `• ${img.count ?? 0} image(s)\n` +
      `• ${arq.count ?? 0} file(s) / spec sheet(s)\n` +
      `• ${desc.count ?? 0} quantity discount(s)\n` +
      `• ${precoCli.count ?? 0} customer-specific price(s)\n` +
      `• ${regua.count ?? 0} price list entry(ies)\n` +
      `• ${acesso.count ?? 0} privacy group permission(s)\n` +
      `• ${acessoCli.count ?? 0} customer permission(s)\n` +
      `• ${variantes.count ?? 0} variant(s), with their prices\n` +
      `• ${opcoes.count ?? 0} product option(s)\n` +
      `• ${regras.count ?? 0} status rule(s)\n` +
      `• ${estoque.count ?? 0} stock history entry(ies)\n` +
      `• ${rel.count ?? 0} related-product link(s) on this product\n` +
      `• ${relDe.count ?? 0} link(s) to this product on OTHER products' pages\n\n` +
      `Only the product itself comes back from the B2BWave sync. Everything above ` +
      `was entered here and cannot be recovered. This cannot be undone.`
    )) return;

    // `.select("id")`: DELETE barrado por RLS tambem afeta zero linhas em silencio
    // — o warehouse via o X na tela (a rota so exige `view_products`), clicava, a
    // linha sumia do React, o toast dizia "Product deleted", e o `activity_logs`
    // gravava com o nome dele uma delecao que nunca aconteceu. Era pior do que log
    // ausente: era log falso na tabela que o admin consulta para saber quem apagou.
    const { data: apagado, error } = await supabase
      .from("produtos").delete().eq("id", productId).select("id").maybeSingle();
    if (error) {
      // O FK de `pedido_itens`/`producao_pedidos` esta CERTO: ele protege o
      // historico. So faltava traduzir — o toast despejava
      // `pedido_itens_produto_id_fkey` na cara do admin.
      toast.error(error.code === "23503"
        ? "This product is used by existing orders or production and cannot be deleted. Set it to Inactive instead."
        : "Could not delete: " + error.message);
      return;
    }
    if (!apagado) {
      toast.error("Nothing was deleted — you do not have permission to delete products.");
      return;
    }
    setProdutos(prev => prev.filter(p => p.id !== productId));
    toast.success("Product deleted");
    log("deleted", "product", productId, produto?.nome);
  };

  return (
    <AdminLayout>
      <h2 className="font-display text-2xl font-semibold mb-4">Products</h2>

      {/* Filters */}
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
          <div>
            <Label className="text-xs text-primary">Name</Label>
            <Input value={filters.name} onChange={e => setFilter("name", e.target.value)} className="h-8" />
          </div>
          <div>
            <Label className="text-xs text-primary">Code</Label>
            <Input value={filters.code} onChange={e => setFilter("code", e.target.value)} className="h-8" />
          </div>
          <div>
            <Label className="text-xs text-primary">Category</Label>
            <Select value={filters.category || "__all__"} onValueChange={v => setFilter("category", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Choose category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Choose category</SelectItem>
                {categoryTreeOptions(categorias).map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-primary">Is active?</Label>
            <Select value={filters.isActive || "__all__"} onValueChange={v => setFilter("isActive", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-primary">Status</Label>
            <Select value={filters.status || "__all__"} onValueChange={v => setFilter("status", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Choose Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Choose Status</SelectItem>
                {statusOptions.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-primary">Brand</Label>
            <Select value={filters.brand || "__all__"} onValueChange={v => setFilter("brand", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Choose brand" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Choose brand</SelectItem>
                {brands.map(b => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm mt-3">
          <div>
            <Label className="text-xs text-primary">Privacy group</Label>
            <Select value={filters.privacyGroup || "__all__"} onValueChange={v => setFilter("privacyGroup", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Choose privacy group" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Choose privacy group</SelectItem>
                {privacyGroups.map(g => <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-primary">Allow Backorder</Label>
            <Select value={filters.allowBackorder || "__all__"} onValueChange={v => setFilter("allowBackorder", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All</SelectItem>
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1"><X className="h-3 w-3" /> Clear</Button>
        </div>
      </Card>

      {/* New product button */}
      <div className="flex items-center justify-between mb-3">
        <Button onClick={() => navigate("/admin/products/new")} className="gap-1 bg-green-600 hover:bg-green-700">
          <Plus className="h-4 w-4" /> New product
        </Button>
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center gap-1 mb-3">
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={pageOk <= 1} onClick={() => setPage(pageOk - 1)}>
            <ChevronLeft className="h-3 w-3" />
          </Button>
          {/* `paginasVisiveis` no lugar da janela fixa. A antiga mostrava sempre
              `1..7` mais as duas ultimas: com 20 paginas, as paginas 8 a 18 nao
              tinham botao. E o item rotulado `...` era um Button que levava para
              `totalPages - 1` — clicar nas reticencias jogava o admin na
              penultima pagina sem avisar. Agora `...` e texto. */}
          {paginasVisiveis(pageOk, totalPages).map((n, i) =>
            n === "..." ? (
              <span key={`e${i}`} className="px-1 text-xs text-muted-foreground select-none">...</span>
            ) : (
              <Button key={n} variant={pageOk === n ? "default" : "outline"} size="icon" className="h-7 w-7 text-xs" onClick={() => setPage(n)}>
                {n}
              </Button>
            ),
          )}
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={pageOk >= totalPages} onClick={() => setPage(pageOk + 1)}>
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16" />
                <TableHead className="text-primary">
                  <div>Code</div>
                  <div className="text-xs font-normal">Name</div>
                </TableHead>
                <TableHead className="text-primary">Category</TableHead>
                <TableHead className="text-primary">
                  <div>Quantity</div>
                  <div className="text-xs font-normal">Status</div>
                </TableHead>
                <TableHead className="text-primary">Active</TableHead>
                <TableHead className="text-primary">
                  <div>Retail</div>
                  <div className="text-xs font-normal">Wholesale Price</div>
                </TableHead>
                <TableHead className="text-primary">
                  <div>Created</div>
                  <div className="text-xs font-normal">Updated</div>
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadError ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8">
                  <p className="text-destructive">Could not load the product list.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    This does NOT mean the catalog is empty — the products could not be read. Do not re-create anything.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => window.location.reload()}>Try again</Button>
                </TableCell></TableRow>
              ) : paginated.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No products found</TableCell></TableRow>
              ) : paginated.map((p) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/products/${p.id}`)}>
                  <TableCell>
                    {p.imagem_url ? (
                      <img src={p.imagem_url} alt={p.nome} className="h-14 w-14 rounded object-cover" />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded bg-muted">
                        <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.sku && <span className="inline-block rounded bg-primary/80 px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground mb-0.5">{p.sku}</span>}
                    <div className="text-primary hover:underline text-sm">{p.nome}</div>
                  </TableCell>
                  <TableCell className="text-sm">{getCategoryName(p.categoria_id)}</TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <div className="text-xs mb-1">Quantity: {p.estoque_total - p.estoque_reservado}</div>
                    <Select
                      value={p.status_produto || "disponivel"}
                      onValueChange={v => handleStatusChange(p.id, v)}
                      disabled={salvando.has(p.id)}
                    >
                      <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {statusOptions.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <Select
                      value={p.ativo ? "Active" : "Inactive"}
                      onValueChange={v => handleActiveChange(p.id, v)}
                      disabled={salvando.has(p.id)}
                    >
                      <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Active">Active</SelectItem>
                        <SelectItem value="Inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">${Number(p.preco_msrp || p.preco).toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">${Number(p.preco).toFixed(2)}</div>
                    {p.custo != null && Number(p.custo) > 0 && (
                      <div className="text-xs text-muted-foreground">${Number(p.custo).toFixed(2)}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    <div>{fmtDate(p.created_at)}</div>
                    <div className="text-muted-foreground">{fmtDate(p.updated_at)}</div>
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <Button variant="default" size="icon" className="h-7 w-7 bg-cyan-600 hover:bg-cyan-700" onClick={() => navigate(`/admin/products/${p.id}`)} title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="default" size="icon" className="h-7 w-7 bg-cyan-600 hover:bg-cyan-700" onClick={() => window.open(`/portal/produto/${p.id}`, '_blank')} title="Preview">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      {/* Escondido para quem o `handleDelete` vai recusar: botao que so serve para
                        dar erro e pior que botao ausente. */}
                    {role === "admin" && (
                    <Button variant="default" size="icon" className="h-7 w-7 bg-destructive hover:bg-destructive/90" onClick={(e) => handleDelete(e, p.id)} title="Delete">
                        <X className="h-3.5 w-3.5 font-bold" />
                      </Button>
                    )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </AdminLayout>
  );
};

export default AdminProdutos;
