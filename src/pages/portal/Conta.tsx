import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/layouts/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, MapPin, Trash2 } from "lucide-react";

const Conta = () => {
  const { user, impersonatedCustomer } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [cliente, setCliente] = useState<any>(null);
  const [enderecos, setEnderecos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newEnd, setNewEnd] = useState({ logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "", cep: "" });

  const fetchData = async () => {
    if (!user && !impersonatedCustomer) return;

    const clienteQuery = impersonatedCustomer?.id
      ? supabase.from("clientes").select("*").eq("id", impersonatedCustomer.id).maybeSingle()
      : supabase.from("clientes").select("*").eq("user_id", user!.id).maybeSingle();

    const profileQuery = impersonatedCustomer?.user_id
      ? supabase.from("profiles").select("*").eq("user_id", impersonatedCustomer.user_id).maybeSingle()
      : user
        ? supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null, error: null } as any);

    const [profRes, cliRes] = await Promise.all([profileQuery, clienteQuery]);
    const nextCliente = cliRes.data;
    const nextProfile = profRes.data ?? (nextCliente ? {
      nome: nextCliente.nome ?? "",
      email: nextCliente.email ?? "",
      telefone: nextCliente.telefone ?? "",
    } : null);

    setProfile(nextProfile);
    setCliente(nextCliente);

    if (nextCliente) {
      const { data } = await supabase.from("enderecos").select("*").eq("cliente_id", nextCliente.id).order("principal", { ascending: false });
      setEnderecos(data ?? []);
    } else {
      setEnderecos([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [user, impersonatedCustomer]);

  const handleSaveProfile = async () => {
    if (!profile || !cliente) return;

    setSaving(true);

    if (impersonatedCustomer?.user_id || user?.id) {
      const profileUserId = impersonatedCustomer?.user_id ?? user?.id;
      if (profileUserId) {
        await supabase.from("profiles").update({ nome: profile.nome, telefone: profile.telefone }).eq("user_id", profileUserId);
      }
    }

    await supabase.from("clientes").update({ nome: profile.nome, telefone: profile.telefone }).eq("id", cliente.id);

    setSaving(false);
    toast.success("Profile updated");
    fetchData();
  };

  const handleAddEndereco = async () => {
    if (!cliente) return;
    const { error } = await supabase.from("enderecos").insert({ ...newEnd, cliente_id: cliente.id });
    if (error) {
      toast.error(error.message);
      return;
    }
    setAddOpen(false);
    setNewEnd({ logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "", cep: "" });
    toast.success("Address added");
    fetchData();
  };

  const handleDeleteEndereco = async (id: string) => {
    await supabase.from("enderecos").delete().eq("id", id);
    toast.success("Address removed");
    fetchData();
  };

  if (loading) return <PortalLayout><div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div></PortalLayout>;

  return (
    <PortalLayout>
      <h2 className="mb-6 font-display text-2xl font-semibold">My Account</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bg-card/80 backdrop-blur-sm">
          <CardHeader><CardTitle className="text-base">Personal Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label>Name</Label><Input value={profile?.nome ?? ""} onChange={(e) => setProfile({ ...profile, nome: e.target.value })} /></div>
            <div className="space-y-2"><Label>Email</Label><Input value={profile?.email ?? user?.email ?? cliente?.email ?? ""} disabled /></div>
            <div className="space-y-2"><Label>Phone</Label><Input value={profile?.telefone ?? ""} onChange={(e) => setProfile({ ...profile, telefone: e.target.value })} /></div>
            {cliente && <div className="space-y-2"><Label>Company</Label><Input value={cliente.empresa} disabled /></div>}
            <Button onClick={handleSaveProfile} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </CardContent>
        </Card>
        <Card className="bg-card/80 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Addresses</CardTitle>
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1"><Plus className="h-4 w-4" /> Add</Button>
              </DialogTrigger>
              <DialogContent className="bg-card/95 backdrop-blur-sm">
                <DialogHeader><DialogTitle>New Address</DialogTitle></DialogHeader>
                <div className="grid gap-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2"><Label>Street</Label><Input value={newEnd.logradouro} onChange={(e) => setNewEnd({ ...newEnd, logradouro: e.target.value })} /></div>
                    <div><Label>Number</Label><Input value={newEnd.numero} onChange={(e) => setNewEnd({ ...newEnd, numero: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>Complement</Label><Input value={newEnd.complemento} onChange={(e) => setNewEnd({ ...newEnd, complemento: e.target.value })} /></div>
                    <div><Label>District</Label><Input value={newEnd.bairro} onChange={(e) => setNewEnd({ ...newEnd, bairro: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div><Label>City</Label><Input value={newEnd.cidade} onChange={(e) => setNewEnd({ ...newEnd, cidade: e.target.value })} /></div>
                    <div><Label>State</Label><Input value={newEnd.estado} onChange={(e) => setNewEnd({ ...newEnd, estado: e.target.value })} /></div>
                    <div><Label>Zip Code</Label><Input value={newEnd.cep} onChange={(e) => setNewEnd({ ...newEnd, cep: e.target.value })} /></div>
                  </div>
                  <Button onClick={handleAddEndereco}>Save Address</Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {enderecos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No addresses registered.</p>
            ) : (
              <div className="space-y-3">
                {enderecos.map((e) => (
                  <div key={e.id} className="flex items-start justify-between rounded-md border border-border/70 bg-background/40 p-3">
                    <div className="flex gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      <div className="text-sm">
                        <p>{e.logradouro}, {e.numero}{e.complemento ? ` - ${e.complemento}` : ""}</p>
                        <p className="text-muted-foreground">{e.bairro ? `${e.bairro} - ` : ""}{e.cidade}/{e.estado} - ZIP {e.cep}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteEndereco(e.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  );
};

export default Conta;
