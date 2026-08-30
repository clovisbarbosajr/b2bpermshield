import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { paginasVisiveis, paginaValida } from "@/lib/paginacao";
import { escaparCelulaCSV } from "@/lib/export-csv";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, ChevronLeft, ChevronRight, Plus, Mail, Download, X, Pencil, Eye, Trash2, Check, Users } from "lucide-react";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

const PAGE_SIZE = 25;

const emptyFilters = {
  company: "", fullName: "", phone: "", email: "", city: "", postalCode: "",
  country: "", state: "", activity: "", priceList: "", isActive: "", referenceCode: "",
  useInAppByAdmin: "", latestOrderFrom: "", latestOrderTo: "", disableOrdering: "",
  salesRep: "", privacyGroup: "",
};

const AdminClientes = () => {
  const navigate = useNavigate();
  // "View as" é SÓ pra admin (regra de negócio) — manager/warehouse nem veem o botão.
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [clientes, setClientes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ ...emptyFilters });
  const [lastOrders, setLastOrders] = useState<Record<string, string>>({});
  const [gruposPorCliente, setGruposPorCliente] = useState<Record<string, string[]>>({});
  const [priceLists, setPriceLists] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [privacyGroups, setPrivacyGroups] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  const fetchData = async () => {
    // ESTA TELA INTEIRA E FEITA EM MEMORIA SOBRE `clientes`: a paginacao, os 17
    // filtros e o Export CSV. Se a leitura vier cortada, o cliente que faltou nao
    // existe em lugar nenhum daqui — e o Export ainda anuncia o total errado como
    // se fosse o total.
    //
    // O estrago pratico nao e so exibicao: o admin busca um cliente antigo pelo
    // e-mail, nao acha, e CADASTRA DUPLICATA — nao ha UNIQUE em `clientes.email`
    // (o proprio `ImportCustomers` documenta isso).
    //
    // `.order("id")` porque paginar exige coluna unica; a ordem por data de
    // cadastro que a tela usa e feita em memoria logo abaixo.
    let data: any[];
    try {
      data = await fetchAllRows<any>((from, to) =>
        supabase.from("clientes").select("*")
          .order("id", { ascending: true }).range(from, to));
      // Mais recente primeiro, espelhando o B2BWave (clone).
      // Sub-logins (funcionários, parent_customer_id preenchido) APARECEM na lista —
      // o admin precisa gerenciá-los (reset de senha etc.) — mas marcados com badge
      // "Employee of <empresa>" pra não parecerem empresa duplicada.
      // COMPARACAO RELACIONAL, NAO `localeCompare`.
      //
      // `created_at` e TIMESTAMPTZ e o PostgREST devolve ISO-8601 com offset. Quando
      // os microssegundos sao exatamente zero, o Postgres OMITE a fracao:
      // "12:00:00+00:00" em vez de "12:00:00.750000+00:00". Nesse ponto as duas
      // strings divergem em `+` contra `.`, e a colacao do `localeCompare` ordena
      // pontuacao antes de simbolo — o INVERSO do code point. Medido:
      // `"...12:00:00+00:00".localeCompare("...12:00:00.750000+00:00")` devolve 1,
      // entao o cliente do segundo cheio subia para o topo como se fosse o mais
      // recente. Com `<`/`>` a ordem ISO e a ordem cronologica, sem excecao.
      //
      // Empate: `Array.sort` e estavel e a leitura vem por `id` asc, entao empate
      // fica deterministico — a query original nao tinha desempate nenhum.
      data.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    } catch (e: any) {
      // FALHA ALTO. Lista vazia sem aviso seria lida como "nao ha cliente".
      toast.error("Could not load customers: " + (e?.message ?? e));
      setLoading(false);
      return;
    }
    const [{ data: pl }, { data: repData }, { data: pg }, { data: acts }] = await Promise.all([
      supabase.from("tabelas_preco").select("id, nome").eq("ativo", true),
      supabase.from("representantes").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("privacy_groups").select("id, nome").eq("ativo", true),
      supabase.from("company_activities").select("id, tipo").order("tipo"),
    ]);
    setClientes(data ?? []);
    setPriceLists(pl ?? []);
    setReps(repData ?? []);
    setPrivacyGroups(pg ?? []);
    setActivities(acts ?? []);
    setLoading(false);

    if (data && data.length > 0) {
      // SEM `.in("cliente_id", clienteIds)`.
      //
      // O filtro por lista de ids ia inteiro na URL. Enquanto `clientes` vinha
      // cortado em 1000 isso passava; agora que a leitura e completa, a mesma
      // linha mandaria milhares de UUIDs na query string e bateria em 414
      // (URI Too Long) — eu teria trocado "resposta errada em silencio" por
      // "tela quebrada" se tivesse so paginado e deixado o `.in` no lugar.
      //
      // Ler a tabela inteira e mais simples e mais barato que montar o filtro em
      // lotes: sao duas colunas, e o resultado e agrupado em memoria do mesmo
      // jeito. O `?? []` cobre cliente sem vinculo e sem pedido.

      // AS DUAS LEITURAS ABAIXO TAMBEM ESTOURAM 1000 — e cada uma faz o filtro
      // RESPONDER ERRADO, sem lista vazia nem erro que denuncie.
      //
      //   `cliente_privacy_groups` e vinculo N-para-N: uma linha por cliente x
      //   grupo. Incompleto, o filtro "Privacy group" faz `includes(...) === false`
      //   e ESCONDE cliente que esta no grupo. Privacidade decide quem ve qual
      //   preco, entao e a auditoria feita aqui que sai errada.
      //
      //   `pedidos` cresce sozinho e a base ja tem ~884 (ver `Pedidos.tsx`). Sem
      //   paginar, so os 1000 mais recentes DA BASE INTEIRA voltam: cliente cujo
      //   ultimo pedido esta fora disso fica com "Last Order" em branco e e lido
      //   como quem nunca comprou. Os filtros "Latest Order From/To" fazem
      //   `if (!ultimo) return false` e escondem essa gente.
      try {
        const vinculos = await fetchAllRows<any>((from, to) =>
          supabase.from("cliente_privacy_groups").select("id, cliente_id, privacy_group_id")
            .order("id", { ascending: true }).range(from, to));
        const porCliente: Record<string, string[]> = {};
        vinculos.forEach((v: any) => {
          (porCliente[v.cliente_id] ??= []).push(v.privacy_group_id);
        });
        setGruposPorCliente(porCliente);

        const orders = await fetchAllRows<any>((from, to) =>
          supabase.from("pedidos").select("id, cliente_id, created_at")
            .order("created_at", { ascending: false }).order("id", { ascending: true })
            .range(from, to));
        const map: Record<string, string> = {};
        orders.forEach((o: any) => { if (!map[o.cliente_id]) map[o.cliente_id] = o.created_at; });
        setLastOrders(map);
      } catch (e: any) {
        // Aviso em vez de silencio: a lista de clientes continua util, mas os
        // filtros de grupo e de data de pedido passariam a mentir caladamente.
        toast.error("Privacy groups / last order did not load — those filters are unreliable: " + (e?.message ?? e));
      }
    }
  };

  useEffect(() => { fetchData(); }, []);

  const setFilter = (key: string, value: string) => setFilters(f => ({ ...f, [key]: value }));
  const clearFilters = () => setFilters({ ...emptyFilters });

  const filtered = clientes.filter((c) => {
    const f = filters;
    if (f.company && !(c.empresa ?? "").toLowerCase().includes(f.company.toLowerCase())) return false;
    if (f.fullName && !(c.nome ?? "").toLowerCase().includes(f.fullName.toLowerCase())) return false;
    if (f.phone && !(c.telefone ?? "").includes(f.phone)) return false;
    if (f.email && !(c.email ?? "").toLowerCase().includes(f.email.toLowerCase())) return false;
    if (f.city && !(c.cidade ?? "").toLowerCase().includes(f.city.toLowerCase())) return false;
    if (f.postalCode && !(c.cep ?? "").includes(f.postalCode)) return false;
    if (f.state && !(c.estado ?? "").toLowerCase().includes(f.state.toLowerCase())) return false;
    if (f.referenceCode && !(c.customer_reference_code ?? "").toLowerCase().includes(f.referenceCode.toLowerCase())) return false;
    if (f.isActive === "yes" && c.is_active !== true) return false;
    if (f.isActive === "no" && c.is_active !== false) return false;
    if (f.disableOrdering === "yes" && c.disable_ordering !== true) return false;
    if (f.disableOrdering === "no" && c.disable_ordering !== false) return false;
    if (f.salesRep && c.representante_id !== f.salesRep) return false;
    if (f.priceList && c.tabela_preco_id !== f.priceList) return false;
    if (f.country && f.country !== "__all__" && !(c.pais ?? "").toLowerCase().includes(f.country.toLowerCase())) return false;

    // ----------------------------------------------------------------------
    // Os quatro abaixo EXISTIAM na tela e nao filtravam nada: o `<Select>`
    // gravava no estado e a lista continuava igual. O usuario escolhia, via a
    // mesma lista, e concluia que "nao tem ninguem com esse filtro" — resposta
    // errada, e nao da para perceber.
    // ----------------------------------------------------------------------

    if (f.activity && (c as any).activity !== f.activity) return false;

    // A data do ultimo pedido ja estava calculada (`lastOrders`) e ja aparecia
    // na coluna da tabela. Faltava so comparar.
    const ultimo = lastOrders[c.id];
    if (f.latestOrderFrom) {
      if (!ultimo) return false;                       // sem pedido nenhum
      if (ultimo.slice(0, 10) < f.latestOrderFrom) return false;
    }
    if (f.latestOrderTo) {
      if (!ultimo) return false;
      if (ultimo.slice(0, 10) > f.latestOrderTo) return false;
    }

    if (f.privacyGroup && !(gruposPorCliente[c.id] ?? []).includes(f.privacyGroup)) return false;

    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  // `paginaValida`: apagar/desativar a unica linha da ultima pagina reduz
  // `totalPages`, a barra inteira desmonta (esta sob `totalPages > 1`) e a fatia
  // fica vazia — beco sem saida, so F5. Ver `paginacao.ts` e o teste que EXECUTA.
  const pageOk = paginaValida(page, totalPages);
  const paginated = filtered.slice((pageOk - 1) * PAGE_SIZE, pageOk * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [filters]);

  const formatDate = (d: string | null) => {
    if (!d) return "";
    const dt = new Date(d);
    return dt.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) + " " +
      dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  };

  const handleDelete = async (e: React.MouseEvent, c: any) => {
    e.stopPropagation();
    if (!confirm(`Permanently delete "${c.empresa || c.nome || c.email}"?\nThis also deletes the login (if any), freeing the email for re-registration.`)) return;
    const { error } = await supabase.from("clientes").delete().eq("id", c.id);
    if (error) { toast.error(`Could not delete: ${error.message}`); return; }
    // Libera o LOGIN também (senão o email fica "preso" — não recadastra nunca).
    // A função recusa sozinha logins de staff ou ainda usados por outra ficha.
    if (c.user_id) {
      const { data } = await supabase.functions.invoke("admin-create-user", {
        body: { action: "delete_user", user_id: c.user_id },
      });
      if (data?.error) toast.warning(`Customer removed, but the login was kept: ${data.error}`);
    }
    toast.success("Customer deleted");
    fetchData();
  };

  const handleToggleActive = async (e: React.MouseEvent, c: any) => {
    e.stopPropagation();
    const newActive = !c.is_active;
    // Sem checar o erro, uma gravação barrada mostrava "Customer activated" e o
    // `fetchData()` logo depois trazia o valor ANTIGO — a linha voltava sozinha,
    // com a mensagem de sucesso ainda na tela.
    const { error } = await supabase.from("clientes").update({ is_active: newActive }).eq("id", c.id);
    if (error) { toast.error("Could not change status: " + error.message); return; }
    toast.success(newActive ? "Customer activated" : "Customer deactivated");
    fetchData();
  };

  const handleExport = () => {
    const headers = ["Company", "Name", "Email", "Phone", "City", "State", "Country", "Status", "Active"];
    const rows = filtered.map((c) => [
      c.empresa || "",
      c.nome || "",
      c.email || "",
      c.telefone || "",
      c.cidade || "",
      c.estado || "",
      c.pais || "",
      c.status || "",
      c.is_active !== false ? "Yes" : "No",
    ]);
    // `escaparCelulaCSV`, e nao aspas na mao: aspas resolvem virgula, NAO resolvem
    // FORMULA — o Excel tira as aspas e avalia a celula. `nome`, `empresa` e
    // `telefone` sao gravaveis pelo proprio cliente (`portal/Conta.tsx`), e este
    // arquivo e aberto pelo admin.
    const csv = [headers, ...rows].map((r) => r.map(escaparCelulaCSV).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customers_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} customers`);
  };

  const handleInvite = async () => {
    if (!inviteEmail) { toast.error("Enter an email"); return; }
    setInviting(true);
    const { error } = await supabase.functions.invoke("send-email", {
      body: { type: "password_reset", email: inviteEmail.trim().toLowerCase(), redirectTo: `${window.location.origin}/reset-password` },
    });
    setInviting(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Invite sent to ${inviteEmail}`);
    setInviteEmail("");
    setInviteOpen(false);
  };

  const handleViewAs = async (e: React.MouseEvent, c: any) => {
    e.stopPropagation();
    // Fluxo por TOKEN (aba isolada): antes gravávamos direto no localStorage,
    // que é COMPARTILHADO entre todas as abas — clicar "View as" transformava
    // todas as abas abertas na visão do cliente. Agora criamos um token de uso
    // único e abrimos /view-as?token=... numa aba nova; SÓ ela consome o token
    // e guarda a impersonação no próprio sessionStorage (por aba). As outras
    // abas continuam na sessão staff normal.
    // A aba é aberta ANTES do await (gesto do usuário) pra não cair no popup blocker.
    const tab = window.open("about:blank", "_blank");
    const { data: token, error } = await (supabase as any).rpc("create_view_as_token", { _customer_id: c.id });
    if (error || !token) {
      tab?.close();
      toast.error("Failed to start View as: " + (error?.message ?? "no token"));
      return;
    }
    const url = `${window.location.origin}/view-as?token=${token}`;
    if (tab) { tab.opener = null; tab.location.href = url; }
    else window.open(url, "_blank", "noopener,noreferrer"); // fallback se o popup foi bloqueado
    toast.info(`Viewing portal as ${c.empresa || c.nome}`);
  };

  return (
    <AdminLayout>
      <h2 className="font-display text-2xl font-semibold mb-4">Customers</h2>

      {/* Advanced Filter Panel */}
      <Card className="mb-4 p-4 bg-card/80 backdrop-blur-sm">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
          <div><Label className="text-xs text-primary">Company</Label><Input value={filters.company} onChange={e => setFilter("company", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">Full Name</Label><Input value={filters.fullName} onChange={e => setFilter("fullName", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">Phone</Label><Input value={filters.phone} onChange={e => setFilter("phone", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">Email</Label><Input value={filters.email} onChange={e => setFilter("email", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">City</Label><Input value={filters.city} onChange={e => setFilter("city", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">Postal code</Label><Input value={filters.postalCode} onChange={e => setFilter("postalCode", e.target.value)} className="h-8" /></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm mt-3">
          <div>
            <Label className="text-xs text-primary">Country</Label>
            <Select value={filters.country || "__all__"} onValueChange={v => setFilter("country", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Please select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Please select...</SelectItem>
                <SelectItem value="United States">United States</SelectItem>
                <SelectItem value="Canada">Canada</SelectItem>
                <SelectItem value="Brazil">Brazil</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs text-primary">State</Label><Input value={filters.state} onChange={e => setFilter("state", e.target.value)} className="h-8" /></div>
          <div>
            <Label className="text-xs text-primary">Activity</Label>
            <Select value={filters.activity || "__all__"} onValueChange={v => setFilter("activity", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Please select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Please select...</SelectItem>
                {activities.map(a => <SelectItem key={a.id} value={a.tipo}>{a.tipo}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-primary">Price List</Label>
            <Select value={filters.priceList || "__all__"} onValueChange={v => setFilter("priceList", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Please select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Please select...</SelectItem>
                {priceLists.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-primary">Is active</Label>
            <Select value={filters.isActive || "__all__"} onValueChange={v => setFilter("isActive", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All</SelectItem>
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs text-primary">Reference code</Label><Input value={filters.referenceCode} onChange={e => setFilter("referenceCode", e.target.value)} className="h-8" /></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 text-sm mt-3">
          <div>
            <Label className="text-xs text-primary">Use in app by admin</Label>
            {/* FILTRO REMOVIDO em 25/ago/2026: nao ha coluna correspondente em
              * `clientes`. Nao era "filtro que nao filtra" por descuido — era
              * filtro SEM LASTRO NENHUM: nao existe o dado que ele diz filtrar.
              * Os outros quatro desta tela foram CONSERTADOS; este nao tinha o
              * que consertar.
              *
              * PARA VOLTAR: criar a coluna primeiro (`clientes.use_in_app_by_admin`
              * ou equivalente), decidir quem a escreve, e so entao descomentar.
              *
              * <Select value={filters.useInAppByAdmin || "__all__"} onValueChange={v => setFilter("useInAppByAdmin", v === "__all__" ? "" : v)}>
              *   <SelectTrigger className="h-8"><SelectValue placeholder="All" /></SelectTrigger>
              *   <SelectContent><SelectItem value="__all__">All</SelectItem><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent>
              * </Select>
              */}
            <p className="text-xs text-muted-foreground h-8 flex items-center">—</p>
          </div>
          <div><Label className="text-xs text-primary">Latest Order From</Label><Input type="date" value={filters.latestOrderFrom} onChange={e => setFilter("latestOrderFrom", e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs text-primary">Latest Order To</Label><Input type="date" value={filters.latestOrderTo} onChange={e => setFilter("latestOrderTo", e.target.value)} className="h-8" /></div>
          <div>
            <Label className="text-xs text-primary">Disable Ordering</Label>
            <Select value={filters.disableOrdering || "__all__"} onValueChange={v => setFilter("disableOrdering", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">All</SelectItem><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-primary">Sales Rep</Label>
            <Select value={filters.salesRep || "__all__"} onValueChange={v => setFilter("salesRep", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Please select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Please select...</SelectItem>
                {reps.map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 text-sm mt-3">
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
        </div>
        <div className="flex items-center gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1"><X className="h-3 w-3" /> Clear</Button>
        </div>
      </Card>

      {/* Action bar */}
      <div className="flex items-center justify-between mb-3">
        <Button onClick={() => navigate("/admin/customers/new")} className="gap-1 bg-green-600 hover:bg-green-700">
          <Plus className="h-4 w-4" /> Create customer
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1 bg-cyan-600 hover:bg-cyan-700 text-white border-0" onClick={() => setInviteOpen(true)}>
            <Mail className="h-4 w-4" /> Invite Customers by Email
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={handleExport}><Download className="h-4 w-4" /> Export</Button>
        </div>
      </div>

      {/* Pagination top */}
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
        <Card className="bg-card/80 backdrop-blur-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-primary">Company</TableHead>
                <TableHead className="text-primary">Full Name</TableHead>
                <TableHead className="text-primary">Email</TableHead>
                <TableHead className="text-primary">Phone</TableHead>
                <TableHead className="text-primary">Created<br/>Last Connection</TableHead>
                <TableHead className="text-primary">Last Order</TableHead>
                <TableHead className="text-primary">Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map((c) => (
                <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/customers/${c.id}`)}>
                  <TableCell>
                    <span className="text-primary hover:underline font-medium">{c.empresa || "—"}</span>
                    {c.parent_customer_id && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        Employee{(() => { const p = clientes.find((x: any) => x.id === c.parent_customer_id); return p ? ` of ${p.empresa || p.nome}` : ""; })()}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{c.nome}</TableCell>
                  <TableCell className="text-primary text-sm">{c.email}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{c.telefone || ""}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {formatDate(c.created_at)}
                    {c.updated_at && c.updated_at !== c.created_at && (<><br /><span className="text-destructive">✕</span></>)}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{formatDate(lastOrders[c.id] || null)}</TableCell>
                  <TableCell>{c.is_active !== false && <Check className="h-4 w-4 text-green-500" />}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <Button variant="default" size="icon" className="h-7 w-7 bg-cyan-600 hover:bg-cyan-700" onClick={() => navigate(`/admin/customers/${c.id}`)} title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {isAdmin && (
                        <Button variant="default" size="icon" className="h-7 w-7 bg-cyan-600 hover:bg-cyan-700" onClick={(e) => handleViewAs(e, c)} title="View as">
                          <Users className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="default" size="icon" className="h-7 w-7 bg-destructive hover:bg-destructive/90" onClick={(e) => handleDelete(e, c)} title="Delete permanently (also frees the login/email)">
                        <X className="h-3.5 w-3.5 font-bold" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {paginated.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No customers found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Customer by Email</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Email address</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="customer@company.com"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              A password reset / invitation email will be sent. The customer must register first at /cadastro or be created in the system.
            </p>
            <Button onClick={handleInvite} disabled={inviting} className="w-full">
              {inviting ? "Sending..." : "Send Invite"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default AdminClientes;
