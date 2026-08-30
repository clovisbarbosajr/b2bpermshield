import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { descendantIds } from "@/lib/categoryTree";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { reordenarIrmaos } from "@/lib/ordemCategorias";
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Check, Monitor, Lock, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";

type Categoria = {
  id: string;
  nome: string;
  descricao: string | null;
  parent_id: string | null;
  ativo: boolean;
  ordem: number;
  desconto: number;
  imagem_url: string | null;
  is_private?: boolean;
  subcategorias_herdam?: boolean;
};

type PrivacyGroup = { id: string; nome: string };
type Customer = { id: string; nome: string; empresa: string | null };

// Acesso (privacidade) de uma categoria — espelha a aba "Access" do B2BWave.
// `loaded` = as ligacoes de acesso desta categoria FORAM lidas do banco. Ver o
// fail-closed em handleSave: `saveAccess` apaga-e-reescreve, entao salvar com um
// snapshot que nunca chegou apagaria grupos e clientes que a tela nunca viu.
type Access = { isPrivate: boolean; herdam: boolean; groups: Set<string>; grant: string[]; exclude: string[]; loaded: boolean };
const emptyAccess = (): Access => ({ isPrivate: false, herdam: true, groups: new Set(), grant: [], exclude: [], loaded: true });

// Picker reutilizável: escolhe clientes de um dropdown e mostra como chips removíveis.
const CustomerPicker = ({ label, options, selected, onChange }: {
  label: string; options: Customer[]; selected: string[]; onChange: (ids: string[]) => void;
}) => {
  const byId = (id: string) => options.find((o) => o.id === id);
  const available = options.filter((o) => !selected.includes(o.id));
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value="" onValueChange={(v) => v && onChange([...selected, v])}>
        <SelectTrigger className="h-9"><SelectValue placeholder="Add customer…" /></SelectTrigger>
        <SelectContent className="max-h-64">
          {available.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">No more customers</div>
          ) : available.map((o) => (
            <SelectItem key={o.id} value={o.id}>{o.empresa || o.nome}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {selected.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1">
              {byId(id)?.empresa || byId(id)?.nome || id}
              <button type="button" onClick={() => onChange(selected.filter((x) => x !== id))}><X className="h-3 w-3" /></button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
};

const AdminCategorias = () => {
  // So para RECUSAR o delete quando a tela nao consegue contar a cascata — ver o
  // comentario em `handleDelete`. Nao esconde nem libera mais nada.
  const { role } = useAuth();
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  // Leitura que falhou NAO e "nao existe categoria": a tela nao pode afirmar
  // isso, e a lista vazia ainda desarma a guarda de ciclo (`parentesProibidos`).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Categoria | null>(null);
  const [form, setForm] = useState({ nome: "", descricao: "", parent_id: "", ativo: true, ordem: 0, desconto: 0 });
  const [acc, setAcc] = useState<Access>(emptyAccess());
  const [pgList, setPgList] = useState<PrivacyGroup[]>([]);
  const [custList, setCustList] = useState<Customer[]>([]);
  const [saving, setSaving] = useState(false);
  // Categoria cuja leitura de acesso e a valida agora. Abrir B (ou "New") enquanto
  // a leitura de A ainda volta fazia o snapshot de A cair em cima de B, e o Save
  // gravava o acesso de A na categoria B.
  const acessoReq = useRef<string | null>(null);
  const navigate = useNavigate();

  const fetchData = async () => {
    // Mostrar também categorias inativas no admin (antes o filtro ativo=true
    // escondia permanentemente uma categoria desativada — bug D6).
    // PAGINA. O `.select("*")` solto corta em 1000 linhas sem erro, e este mesmo
    // arquivo ja pagina `clientes` e `produtos` pelo mesmo motivo. Com a lista
    // truncada nao e so a exibicao que fica errada: `moveCategory` e
    // `sortAlphabetically` REESCREVEM `ordem` por cima do que leram, e o irmao
    // que ficou fora do corte volta a colidir. O `.order("id")` desempata para o
    // `range` ser deterministico.
    let data: Categoria[] | null = null;
    let error: { message: string } | null = null;
    try {
      data = await fetchAllRows<Categoria>((from, to) => supabase
        .from("categorias").select("*")
        .order("ordem").order("nome").order("id", { ascending: true }).range(from, to) as any);
    } catch (e: any) {
      error = { message: e?.message ?? String(e) };
    }
    setLoading(false);
    // Sem isto a tela dizia "No categories yet" quando a LEITURA falhou, e a lista
    // vazia ainda desarmava a guarda de ciclo (`parentesProibidos`). Mantem o que
    // ja estava na tela e avisa.
    if (error) {
      setLoadError(error.message);
      toast.error("Could not load categories: " + error.message);
      return;
    }
    setLoadError(null);
    setCategorias((data as Categoria[]) ?? []);
  };

  useEffect(() => { fetchData(); }, []);

  // Grupos de privacidade + clientes (só donos de conta — subs herdam o pai) para os pickers.
  useEffect(() => {
    (async () => {
      const { data: pg, error: pgErr } = await supabase.from("privacy_groups").select("id, nome").order("nome");
      if (pgErr) toast.error("Could not load privacy groups: " + pgErr.message);
      else setPgList((pg as PrivacyGroup[]) ?? []);
      try {
        // `clientes` cresce sem limite (uma linha por cliente cadastrado) e o
        // PostgREST corta em 1000 SEM erro: sem paginar, o cliente 1001 nunca
        // aparecia no picker e nao dava pra liberar/excluir o acesso dele.
        const cu = await fetchAllRows<Customer>((from, to) =>
          supabase.from("clientes").select("id, nome, empresa").is("parent_customer_id", null)
            .order("empresa").order("id", { ascending: true }).range(from, to));
        setCustList(cu);
      } catch (e: any) {
        toast.error("Could not load customers: " + (e?.message ?? String(e)));
      }
    })();
  }, []);

  const openNew = () => {
    acessoReq.current = null;
    setEditing(null);
    setForm({ nome: "", descricao: "", parent_id: "", ativo: true, ordem: 0, desconto: 0 });
    setAcc(emptyAccess());
    setDialogOpen(true);
  };

  const openEdit = async (c: Categoria) => {
    acessoReq.current = c.id;
    setEditing(c);
    setForm({
      nome: c.nome,
      descricao: c.descricao ?? "",
      parent_id: c.parent_id ?? "",
      ativo: c.ativo,
      ordem: c.ordem ?? 0,
      desconto: c.desconto ?? 0,
    });
    // `loaded: false` ate a leitura voltar. O dialogo abre ANTES do await, entao
    // este e tambem o estado de quem clica Save no primeiro segundo.
    setAcc({
      isPrivate: c.is_private ?? false,
      herdam: c.subcategorias_herdam ?? true,
      groups: new Set(), grant: [], exclude: [], loaded: false,
    });
    setDialogOpen(true);
    // Carrega as ligações de acesso da categoria.
    const [{ data: ca, error: caErr }, { data: cca, error: ccaErr }] = await Promise.all([
      supabase.from("categoria_acesso").select("privacy_group_id").eq("categoria_id", c.id),
      supabase.from("categoria_cliente_acesso").select("cliente_id, tipo").eq("categoria_id", c.id),
    ]);
    if (acessoReq.current !== c.id) return; // outra categoria foi aberta no meio
    // Leitura falhou -> NAO marca `loaded`. Antes nao se olhava o erro: a tela
    // mostrava "sem grupo, sem cliente" e o Save seguinte apagava as ligacoes
    // reais (saveAccess e DELETE + INSERT), com "Category updated" na tela.
    if (caErr || ccaErr) {
      toast.error("Could not load this category's access settings: " + (caErr ?? ccaErr)!.message);
      return;
    }
    setAcc({
      isPrivate: c.is_private ?? false,
      herdam: c.subcategorias_herdam ?? true,
      groups: new Set((ca ?? []).map((r) => r.privacy_group_id)),
      grant: (cca ?? []).filter((r) => r.tipo === "grant").map((r) => r.cliente_id),
      exclude: (cca ?? []).filter((r) => r.tipo === "exclude").map((r) => r.cliente_id),
      loaded: true,
    });
  };

  // Persiste as 3 ligações de acesso (grupos, grant, exclude) de uma categoria.
  // Devolve a mensagem de erro da PRIMEIRA operacao que falhar, ou null.
  //
  // E apaga-e-reescreve sem transacao: se o insert falhar depois do delete, o que
  // existia ja se foi. Por isso o erro sobe e a tela conta o que aconteceu — dizer
  // "Category updated" por cima disso e que era o estrago.
  const saveAccess = async (categoriaId: string): Promise<string | null> => {
    const delG = await supabase.from("categoria_acesso").delete().eq("categoria_id", categoriaId);
    if (delG.error) return delG.error.message;
    if (acc.isPrivate && acc.groups.size > 0) {
      const insG = await supabase.from("categoria_acesso").insert(
        [...acc.groups].map((g) => ({ categoria_id: categoriaId, privacy_group_id: g })),
      );
      if (insG.error) return insG.error.message;
    }
    const delC = await supabase.from("categoria_cliente_acesso").delete().eq("categoria_id", categoriaId);
    if (delC.error) return delC.error.message;
    const rows = acc.isPrivate
      ? [
          ...acc.grant.map((cid) => ({ categoria_id: categoriaId, cliente_id: cid, tipo: "grant" })),
          ...acc.exclude.map((cid) => ({ categoria_id: categoriaId, cliente_id: cid, tipo: "exclude" })),
        ]
      : [];
    if (rows.length > 0) {
      const insC = await supabase.from("categoria_cliente_acesso").insert(rows);
      if (insC.error) return insC.error.message;
    }
    return null;
  };

  // Categorias que NÃO podem ser pai da que está sendo editada: ela mesma e todos
  // os descendentes. Vazio ao criar uma nova (não tem descendente ainda).
  const parentesProibidos = new Set(editing ? descendantIds(categorias, editing.id) : []);

  const handleSave = async () => {
    if (!form.nome.trim()) { toast.error("Name is required"); return; }
    // Trava também no salvar, não só no select: o `form.parent_id` pode ter sido
    // escolhido antes de trocar de categoria no diálogo, e um ciclo gravado
    // derruba o catálogo do cliente (tela branca) e trava o RLS recursivo.
    if (form.parent_id && parentesProibidos.has(form.parent_id)) {
      toast.error("A category cannot be placed inside itself or one of its own sub-categories.");
      return;
    }
    // FAIL CLOSED: sem o snapshot de acesso lido, `saveAccess` apagaria grupos e
    // clientes que esta tela nunca chegou a ver.
    if (editing && !acc.loaded) {
      toast.error("Access settings have not loaded for this category — close and reopen it before saving, otherwise its privacy settings would be erased.");
      return;
    }
    setSaving(true);
    const payload = {
      nome: form.nome,
      descricao: form.descricao || null,
      parent_id: form.parent_id || null,
      ativo: form.ativo,
      ordem: form.ordem,
      desconto: form.desconto,
      is_private: acc.isPrivate,
      subcategorias_herdam: acc.herdam,
    };
    let categoriaId = editing?.id;
    if (editing) {
      // `.select("id")` DE CONFIRMACAO, e o `saveAccess` so roda se a linha foi
      // mesmo escrita.
      //
      // A RLS de `categorias` e admin-only (20260317043654:177), mas a de
      // `categoria_acesso`/`categoria_cliente_acesso` aceita admin OU MANAGER
      // (20260622191614:48) — e esta tela e `perm="view_products"`, que manager e
      // warehouse tem. Sem confirmar, o UPDATE de manager voltava 204 com
      // `error: null` (nada gravado) e o `saveAccess` logo abaixo, que ela PODE
      // rodar, apagava todas as concessoes de grupo e de cliente. Com o
      // formulario dizendo "nao e privada" ele nao reinseria nada: categoria que
      // continuou PRIVADA no banco, agora com ZERO concessoes — some do catalogo
      // de todo mundo, e a lista apagada nao existe em lugar nenhum para desfazer.
      // A tela dizia "Category updated".
      const { data: gravado, error } = await supabase.from("categorias")
        .update(payload as any).eq("id", editing.id).select("id").maybeSingle();
      if (error) { toast.error(error.message); setSaving(false); return; }
      if (!gravado) {
        toast.error("Nothing was saved — the category no longer exists, or you do not have permission to edit categories. The access settings were left untouched.");
        setSaving(false);
        return;
      }
    } else {
      const { data, error } = await supabase.from("categorias").insert(payload as any).select("id").single();
      if (error) { toast.error(error.message); setSaving(false); return; }
      categoriaId = (data as any).id;
    }
    const accErr = categoriaId ? await saveAccess(categoriaId) : null;
    setSaving(false);
    setDialogOpen(false);
    fetchData();
    if (accErr) {
      toast.error("Category saved, but the access settings were NOT written (the previous ones may already have been removed): " + accErr);
      return;
    }
    toast.success(editing ? "Category updated" : "Category created");
  };

  const handleDelete = async (id: string) => {
    // MESMA FALHA-ABERTA do `Produtos.handleDelete`: contagem barrada por RLS nao
    // e erro (`count: 0`, `error: null`), e a guarda de `.error` logo abaixo nao a
    // pega. `user_locations` tem policy so de admin para escrita e "own rows" para
    // leitura, entao o manager/warehouse conta apenas as PROPRIAS linhas e o aviso
    // ("aqueles usuarios passarao a ver a producao de TODAS as localizacoes") sai
    // com zero.
    //
    // Esta tela e alcancavel por eles: `/admin/product-categories` exige so
    // `view_products` (`App.tsx:205`) — a outra rota, `/admin/categorias`, e
    // admin-only, e por isso o problema passou despercebido.
    //
    // Aqui o dano e menor que em `Produtos`: `categorias` so tem policy de escrita
    // para admin, entao o DELETE casa zero linhas e o `if (!apagado)` avisa. O que
    // sobra e um dialogo que MENTE sobre a cascata antes de uma acao que nao vai
    // acontecer. Recusar antes e mais honesto que perguntar errado.
    if (role !== "admin") {
      toast.error(
        "Only administrators can delete categories. Some of the records that would be affected " +
        "are not visible to your role, so this screen cannot tell you what would be lost."
      );
      return;
    }

    // CONTA A CASCATA ANTES DE PERGUNTAR — molde de `PrivacyGroups.handleDelete`,
    // que ja faz isso com teste (`acessoFalhaFechada.test.ts:69`).
    //
    // "Delete this category?" escondia tres efeitos, dois deles de acesso:
    //   `produtos.categoria_id ON DELETE SET NULL` (20260317043654:102) — e
    //     `cliente_pode_ver_produto` PULA a checagem quando a categoria e nula
    //     (20260825280000:185). Apagar categoria PRIVADA torna os produtos dela
    //     visiveis, com preco, para toda a base de clientes.
    //   `categorias.parent_id ON DELETE SET NULL` (20260318182853:3) — as filhas
    //     viram raiz. Fecha o acesso em vez de abrir, mas muda o escopo calado.
    //   `user_locations.categoria_id ON DELETE CASCADE` (20260619220000:10) — e
    //     `user_can_see_produto` devolve true quando NAO EXISTE amarracao
    //     (20260619220000:27). Apagar a categoria de uma localizacao faz o
    //     usuario amarrado so a ela passar a ver a producao de TODAS.
    //
    // Falha ao contar RECUSA o delete: nao da para avisar sobre o que nao se leu.
    const [prod, filhas, locais] = await Promise.all([
      supabase.from("produtos").select("id", { count: "exact", head: true }).eq("categoria_id", id),
      supabase.from("categorias").select("id", { count: "exact", head: true }).eq("parent_id", id),
      supabase.from("user_locations").select("id", { count: "exact", head: true }).eq("categoria_id", id),
    ]);
    if (prod.error || filhas.error || locais.error) {
      toast.error("Could not check what this category is used by — nothing was deleted. Try again.");
      return;
    }
    const partes: string[] = [];
    if (prod.count) partes.push(`${prod.count} product(s) will lose their category — private ones become visible to every customer`);
    if (filhas.count) partes.push(`${filhas.count} subcategory(ies) will become top-level`);
    if (locais.count) partes.push(`${locais.count} user location assignment(s) will be deleted — those users will see production from EVERY location`);
    const NL = String.fromCharCode(10);
    const aviso = partes.length
      ? ["Delete this category?", "", ...partes.map((p) => "• " + p), "", "This cannot be undone."].join(NL)
      : "Delete this category?";
    if (!confirm(aviso)) return;

    const { data: apagado, error } = await supabase.from("categorias")
      .delete().eq("id", id).select("id").maybeSingle();
    if (error) { toast.error(error.message); return; }
    if (!apagado) {
      toast.error("Nothing was deleted — the category no longer exists, or you do not have permission.");
      fetchData();
      return;
    }
    toast.success("Category removed");
    fetchData();
  };

  const moveCategory = async (cat: Categoria, direction: "up" | "down") => {
    const siblings = categorias.filter(c => c.parent_id === cat.parent_id);
    const idx = siblings.findIndex(c => c.id === cat.id);
    if (direction === "up" && idx <= 0) return;
    if (direction === "down" && idx >= siblings.length - 1) return;

    // SEMPRE REINDEXA os irmaos — nunca troca dois valores de `ordem`.
    //
    // O ramo de troca so estava correto quando os DOIS vizinhos tinham `ordem`
    // distinta entre si E de todo o resto. `ordem` e `NOT NULL DEFAULT 0`, o
    // formulario de nova categoria parte de 0, e o sync nao garante valor
    // distinto (`parseInt(c.position || c.sort_order || "0") || 0`), entao empate
    // e o estado NORMAL desta arvore. Com empate no PAR, a troca gravava 0 e 0:
    // as duas escritas passavam e o botao nao fazia nada. E com empate entre
    // OUTROS irmaos — `Z(0), A(1), B(1)`, clicar "down" em Z — a troca passava
    // pela guarda do par, gravava Z:=1, e a releitura por `(ordem, nome)` punha
    // Z depois de B: um clique, DUAS casas, sem toast nenhum.
    //
    // Reindexar 0..n-1 acerta os dois casos e um monte de outros, entao o ramo de
    // troca sai inteiro em vez de ganhar mais uma guarda.
    const nova = reordenarIrmaos(siblings, idx, direction);
    // `.select("id")` em CADA escrita, pelo mesmo motivo que `handleSave` e
    // `handleDelete` ganharam: a RLS de `categorias` e admin-only
    // (20260317043654:177) e esta tela e `perm="view_products"`, que manager e
    // warehouse tem. Sem confirmar, o UPDATE deles voltava 204 com `error: null`
    // e o botao Move era um no-op MUDO — o mesmo sintoma que a reindexacao veio
    // consertar.
    const escritas = await Promise.all(nova.map((c, i) =>
      supabase.from("categorias").update({ ordem: i } as any).eq("id", c.id).select("id")));
    fetchData();
    const errR = escritas.find((r) => r.error)?.error;
    if (errR) {
      toast.error("Could not reorder — the list may be out of order, refresh and try again: " + errR.message);
      return;
    }
    if (escritas.some((r) => !r.data?.length)) {
      // Zero linhas sem erro tem DUAS causas, e a mensagem nao pode escolher uma:
      // a RLS recusando calada, ou um dos irmaos ter sido apagado por outro admin
      // entre a leitura e a escrita. No segundo caso as outras N-1 escritas
      // PASSARAM, e acusar falta de permissao mandaria o admin ao lugar errado.
      // Formula igual a do `handleDelete` deste mesmo arquivo.
      toast.error("Part of the reorder did not apply — a category no longer exists, or you do not have permission to change categories. The list was reloaded.");
    }
  };

  const sortAlphabetically = async () => {
    const sorted = [...categorias].sort((a, b) => a.nome.localeCompare(b.nome));
    // Sao N escritas em sequencia. Se a de indice K falhar, as anteriores JA
    // passaram: a ordenacao fica pela METADE, e antes a tela dizia "ordenado".
    // Parar no primeiro erro e dizer ate onde foi e melhor que fingir sucesso.
    for (let i = 0; i < sorted.length; i++) {
      const { data: gravado, error } = await supabase.from("categorias")
        .update({ ordem: i } as any).eq("id", sorted[i].id).select("id");
      if (error) {
        toast.error(`Sorting stopped at "${sorted[i].nome}" — the first ${i} were reordered: ${error.message}`);
        fetchData();
        return;
      }
      // Zero linhas sem erro e a RLS recusando calada (manager/warehouse chegam
      // nesta tela). Sem isto, o laco ia ate o fim e a tela dizia "Categories
      // sorted alphabetically" com NADA gravado.
      if (!gravado?.length) {
        toast.error("Nothing was sorted — you do not have permission to change categories.");
        fetchData();
        return;
      }
    }
    toast.success("Categories sorted alphabetically");
    fetchData();
  };

  // Build flat ordered list with hierarchy
  const rootCats = categorias.filter(c => !c.parent_id).sort((a, b) => a.ordem - b.ordem);
  const childrenOf = (parentId: string) =>
    categorias.filter(c => c.parent_id === parentId).sort((a, b) => a.ordem - b.ordem);

  const parentName = (parentId: string | null) => {
    if (!parentId) return "";
    return categorias.find(c => c.id === parentId)?.nome ?? "";
  };

  // Count products per category
  // `null` = ainda nao sei contar (carregando ou falhou) — a badge mostra "—" em
  // vez de "0", que afirmaria que a categoria esta vazia.
  const [productCounts, setProductCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        // `produtos` cresce sem limite com o catalogo e o PostgREST corta em 1000
        // linhas SEM erro: uma leitura so ja subcontava as categorias do fim.
        const rows = await fetchAllRows<{ id: string; categoria_id: string | null }>((from, to) =>
          supabase.from("produtos").select("id, categoria_id").eq("ativo", true)
            .order("id", { ascending: true }).range(from, to));
        const counts: Record<string, number> = {};
        rows.forEach((p) => { if (p.categoria_id) counts[p.categoria_id] = (counts[p.categoria_id] || 0) + 1; });
        setProductCounts(counts);
      } catch (e: any) {
        toast.error("Could not count products per category: " + (e?.message ?? String(e)));
      }
    };
    fetchCounts();
  }, []);

  const buildFlatList = (cats: Categoria[], level: number = 0): { cat: Categoria; level: number }[] =>
    cats.flatMap(c => [
      { cat: c, level },
      ...buildFlatList(childrenOf(c.id), level + 1),
    ]);

  const flatList = buildFlatList(rootCats);

  // Determine siblings for move button visibility
  const getSiblings = (cat: Categoria) => categorias.filter(c => c.parent_id === cat.parent_id);
  const getSiblingIndex = (cat: Categoria) => {
    const siblings = getSiblings(cat);
    return siblings.findIndex(c => c.id === cat.id);
  };

  return (
    <AdminLayout>
      <div className="mb-4">
        <h2 className="font-display text-2xl font-semibold">Product Categories</h2>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <Button onClick={openNew} className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white">
          <Plus className="h-4 w-4" /> New category
        </Button>
        <Button variant="outline" onClick={sortAlphabetically} className="gap-1 text-sm border-cyan-600 text-cyan-400 hover:bg-cyan-600/10">
          Sort categories alphabetically
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border">
                <TableHead className="text-primary font-semibold">Name</TableHead>
                <TableHead className="text-primary font-semibold">Parent category</TableHead>
                <TableHead className="text-primary font-semibold w-28 text-center">Move</TableHead>
                <TableHead className="text-primary font-semibold w-20 text-center">Active</TableHead>
                <TableHead className="text-primary font-semibold w-24 text-center">Discount</TableHead>
                <TableHead className="w-36" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {flatList.map(({ cat, level }) => {
                const siblings = getSiblings(cat);
                const idx = getSiblingIndex(cat);
                const canMoveUp = idx > 0;
                const canMoveDown = idx < siblings.length - 1;

                return (
                  <TableRow key={cat.id} className="border-b border-border/50">
                    <TableCell>
                      <span style={{ paddingLeft: level * 24 }} className="flex items-center gap-2">
                        <span className="font-medium text-primary">{cat.nome}</span>
                        {cat.is_private && <Lock className="h-3 w-3 text-amber-500" aria-label="Private" />}
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground border-muted-foreground/30">
                          {productCounts ? productCounts[cat.id] || 0 : "—"}
                        </Badge>
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {parentName(cat.parent_id)}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex gap-1 justify-center">
                        {canMoveUp && (
                          <Button
                            variant="default"
                            size="icon"
                            className="h-7 w-7 bg-cyan-600 hover:bg-cyan-700"
                            onClick={() => moveCategory(cat, "up")}
                            title="Move up"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canMoveDown && (
                          <Button
                            variant="default"
                            size="icon"
                            className="h-7 w-7 bg-cyan-600 hover:bg-cyan-700"
                            onClick={() => moveCategory(cat, "down")}
                            title="Move down"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {cat.ativo && <Check className="h-4 w-4 text-green-500 mx-auto" />}
                    </TableCell>
                    <TableCell className="text-center">
                      {cat.desconto ? `${cat.desconto}%` : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="default"
                          size="icon"
                          className="h-7 w-7 bg-cyan-600 hover:bg-cyan-700"
                          onClick={() => openEdit(cat)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="default"
                          size="icon"
                          className="h-7 w-7 bg-cyan-600 hover:bg-cyan-700"
                          onClick={() => navigate(`/portal/catalogo?category=${cat.id}`)}
                          title="View as"
                        >
                          <Monitor className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="default"
                          size="icon"
                          className="h-7 w-7 bg-destructive hover:bg-destructive/90"
                          disabled={role !== "admin"}
                          onClick={() => handleDelete(cat.id)}
                          title={role !== "admin" ? "Only administrators can delete categories" : "Delete"}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {loadError && flatList.length > 0 && (
                // O ERRO TAMBEM COM A LISTA CHEIA.
                //
                // O outro ponto que mostra `loadError` esta dentro de
                // `flatList.length === 0`. Mas `fetchData()` roda de novo depois de
                // salvar, apagar, mover e ordenar: se ESSE refetch falhar com a
                // lista ja carregada, o estado ficava setado e a tela nao mostrava
                // nada — a grade seguia exibindo a ordem ANTERIOR e o admin clicava
                // "Move" de novo em cima de dado velho. Mesmo defeito que o
                // Catalogo teve.
                <TableRow>
                  <TableCell colSpan={6} className="py-3">
                    <div className="flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                      <p className="text-sm text-destructive font-medium flex-1">
                        Could not refresh the list — you may be seeing outdated data. {loadError}
                      </p>
                      <Button variant="outline" size="sm"
                        onClick={() => { setLoading(true); fetchData(); }}>
                        Try again
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {flatList.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10">
                    {loadError ? (
                      <div className="text-muted-foreground">
                        <p className="text-destructive font-medium">Could not load categories</p>
                        <p className="text-sm mt-1">{loadError}</p>
                        <Button variant="outline" size="sm" className="mt-3"
                          onClick={() => { setLoading(true); fetchData(); }}>
                          Try again
                        </Button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">No categories yet.</span>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Category" : "New Category"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div>
              <Label>Description</Label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                rows={3}
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              />
            </div>
            <div>
              <Label>Parent Category</Label>
              <Select value={form.parent_id} onValueChange={(v) => setForm({ ...form, parent_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="None (root)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (root)</SelectItem>
                  {/* Exclui a própria categoria E TODOS os descendentes dela. Antes
                      excluía só a própria: dava pra pôr "Accessories - FL" como filha
                      de "PermTread", que é filha dela — o ciclo derrubava o catálogo
                      do cliente com tela branca e travava o RLS recursivo. */}
                  {categorias.filter((c) => !parentesProibidos.has(c.id)).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.parent_id ? `↳ ${c.nome}` : c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Order</Label>
                <Input type="number" value={form.ordem} onChange={(e) => setForm({ ...form, ordem: parseInt(e.target.value) || 0 })} />
              </div>
              <div>
                <Label>Discount (%)</Label>
                <Input type="number" value={form.desconto} onChange={(e) => setForm({ ...form, desconto: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm pb-2">
                <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
                Active
              </label>
            </div>

            {/* Access — privacidade (modelo B2BWave) */}
            <div className="border-t pt-3 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <Checkbox checked={acc.isPrivate} onCheckedChange={(v) => setAcc((a) => ({ ...a, isPrivate: v === true }))} />
                <Lock className="h-3.5 w-3.5 text-amber-500" /> Private — visible only to selected customers
              </label>
              {acc.isPrivate && (
                <div className="space-y-3 pl-1">
                  <div>
                    <Label className="text-xs text-muted-foreground">Privacy groups</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {pgList.length === 0 && <span className="text-xs text-muted-foreground">No privacy groups yet.</span>}
                      {pgList.map((g) => (
                        <label key={g.id} className="flex items-center gap-1.5 text-sm border rounded px-2 py-1 cursor-pointer">
                          <Checkbox
                            checked={acc.groups.has(g.id)}
                            onCheckedChange={(v) => setAcc((a) => {
                              const s = new Set(a.groups);
                              if (v === true) s.add(g.id); else s.delete(g.id);
                              return { ...a, groups: s };
                            })}
                          />
                          {g.nome}
                        </label>
                      ))}
                    </div>
                  </div>
                  <CustomerPicker label="Grant access to specific customers" options={custList}
                    selected={acc.grant} onChange={(ids) => setAcc((a) => ({ ...a, grant: ids }))} />
                  <CustomerPicker label="Exclude customers from accessing category" options={custList}
                    selected={acc.exclude} onChange={(ids) => setAcc((a) => ({ ...a, exclude: ids }))} />
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={acc.herdam} onCheckedChange={(v) => setAcc((a) => ({ ...a, herdam: v === true }))} />
                    Subcategories inherit these access settings
                  </label>
                </div>
              )}
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default AdminCategorias;
