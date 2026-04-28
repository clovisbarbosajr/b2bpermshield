import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
import { toast } from "sonner";

const PAGE_SIZE = 25;

const emptyFilters = {
  company: "", fullName: "", phone: "", email: "", city: "", postalCode: "",
  country: "", state: "", activity: "", priceList: "", isActive: "", referenceCode: "",
  useInAppByAdmin: "", latestOrderFrom: "", latestOrderTo: "", disableOrdering: "",
  salesRep: "", privacyGroup: "",
};

const AdminClientes = () => {
  const navigate = useNavigate();
  const [clientes, setClientes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ ...emptyFilters });
  const [lastOrders, setLastOrders] = useState<Record<string, string>>({});
  const [priceLists, setPriceLists] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [privacyGroups, setPrivacyGroups] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  const fetchData = async () => {
    const [{ data }, { data: pl }, { data: repData }, { data: pg }, { data: acts }] = await Promise.all([
      supabase.from("clientes").select("*").order("empresa"),
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
      const clienteIds = data.map((c: any) => c.id);
      const { data: orders } = await supabase
        .from("pedidos").select("cliente_id, created_at").in("cliente_id", clienteIds)
        .order("created_at", { ascending: false });
      if (orders) {
        const map: Record<string, string> = {};
        orders.forEach((o: any) => { if (!map[o.cliente_id]) map[o.cliente_id] = o.created_at; });
        setLastOrders(map);
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
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [filters]);

  const formatDate = (d: string | null) => {
    if (!d) return "";
    const dt = new Date(d);
    return dt.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) + " " +
      dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("Delete this customer?")) return;
    await supabase.from("clientes").delete().eq("id", id);
    toast.success("Customer deleted");
    fetchData();
  };

  const handleToggleActive = async (e: React.MouseEvent, c: any) => {
    e.stopPropagation();
    const newActive = !c.is_active;
    await supabase.from("clientes").update({ is_active: newActive }).eq("id", c.id);
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
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
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
    const { error } = await supabase.auth.resetPasswordForEmail(inviteEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setInviting(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Invite sent to ${inviteEmail}`);
    setInviteEmail("");
    setInviteOpen(false);
  };

  const handleViewAs = (e: React.MouseEvent, c: any) => {
    e.stopPropagation();
    const viewAsData = {
      id: c.id,
      user_id: c.user_id,
      empresa: c.empresa,
      nome: c.nome,
      email: c.email,
      tabela_preco_id: c.tabela_preco_id,
    };
    localStorage.setItem("viewAsCustomer", JSON.stringify(viewAsData));
    window.open("/portal", "_blank", "noopener,noreferrer");
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
            <Select value={filters.useInAppByAdmin || "__all__"} onValueChange={v => setFilter("useInAppByAdmin", v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">All</SelectItem><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent>
            </Select>
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
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="h-3 w-3" />
          </Button>
          {Array.from({ length: Math.min(totalPages, 9) }, (_, i) => {
            let pageNum: number;
            if (totalPages <= 9) pageNum = i + 1;
            else if (i < 7) pageNum = i + 1;
            else if (i === 7) pageNum = totalPages - 1;
            else pageNum = totalPages;
            return (
              <Button key={i} variant={page === pageNum ? "default" : "outline"} size="icon" className="h-7 w-7 text-xs" onClick={() => setPage(pageNum)}>
                {i === 7 && totalPages > 9 && pageNum !== 8 ? "..." : pageNum}
              </Button>
            );
          })}
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
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
                  <TableCell><span className="text-primary hover:underline font-medium">{c.empresa || "—"}</span></TableCell>
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
                      <Button variant="default" size="icon" className="h-7 w-7 bg-cyan-600 hover:bg-cyan-700" onClick={(e) => handleViewAs(e, c)} title="View as">
                        <Users className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="default" size="icon" className="h-7 w-7 bg-destructive hover:bg-destructive/90" onClick={(e) => handleDelete(e, c.id)} title="Delete">
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
