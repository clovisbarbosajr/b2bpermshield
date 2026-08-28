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

// Endereco pertence a conta da EMPRESA: sub-login LE e GRAVA sob o id do PAI.
// Mesma regra do Checkout (`addressClienteId`, Checkout.tsx:147/:154). Enquanto
// os dois discordavam, o endereco salvo aqui simplesmente nao aparecia la.
export const enderecoOwnerId = (cliente: any): string =>
  cliente?.parent_customer_id ?? cliente?.id;

// Sem isto, "Save Address" gravava endereco EM BRANCO, que virava opcao
// selecionavel no checkout. Mesmos obrigatorios do Checkout (`saveNewAddress`).
export const enderecoIncompleto = (e: { logradouro: string; cidade: string; estado: string; cep: string }) =>
  !e.logradouro.trim() || !e.cidade.trim() || !e.estado.trim() || !e.cep.trim();

// As duas escritas ficam FORA do componente para poderem ser exercitadas sob
// concorrencia (Conta.enderecos.test.ts). Os handlers abaixo so traduzem o
// resultado em toast.
export async function adicionarEndereco(
  db: typeof supabase,
  cliente: any,
  novo: { logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; estado: string; cep: string },
) {
  if (enderecoIncompleto(novo)) return { ok: false as const, motivo: "incompleto" as const };
  const { error } = await db.from("enderecos").insert({ ...novo, cliente_id: enderecoOwnerId(cliente) });
  if (error) return { ok: false as const, motivo: "erro" as const, mensagem: error.message };
  return { ok: true as const };
}

export async function removerEndereco(db: typeof supabase, id: string) {
  // `.select()` para saber se ALGUMA linha saiu: o supabase-js nao levanta erro
  // quando a RLS filtra tudo (afeta zero linhas e volta sem `error`), e o
  // sub-login so tem SELECT/INSERT nos enderecos do pai, nunca DELETE
  // (20260801120000). Sem isto a tela dizia "Address removed" sem remover nada —
  // e o mesmo vale para duas abas apagando o mesmo endereco ao mesmo tempo.
  const { data, error } = await db.from("enderecos").delete().eq("id", id).select("id");
  if (error) return { ok: false as const, motivo: "erro" as const, mensagem: error.message };
  if (!data?.length) return { ok: false as const, motivo: "nada" as const };
  return { ok: true as const };
}

const Conta = () => {
  const { user, impersonatedCustomer } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [cliente, setCliente] = useState<any>(null);
  const [enderecos, setEnderecos] = useState<any[]>([]);
  const [enderecosErro, setEnderecosErro] = useState(false);
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
    // Falha aqui deixava a tela inteira vazia em silencio, com o botao Save
    // virando no-op (`if (!profile || !cliente) return`).
    if (cliRes.error) toast.error("Could not load your account details: " + cliRes.error.message);
    const nextCliente = cliRes.data;
    const nextProfile = profRes.data ?? (nextCliente ? {
      nome: nextCliente.nome ?? "",
      email: nextCliente.email ?? "",
      telefone: nextCliente.telefone ?? "",
    } : null);

    setProfile(nextProfile);
    setCliente(nextCliente);

    if (nextCliente) {
      const { data, error } = await supabase.from("enderecos").select("*")
        .eq("cliente_id", enderecoOwnerId(nextCliente)).order("principal", { ascending: false });
      // Sem checar o `error`, falha de leitura virava "No addresses registered."
      // — a tela AFIRMANDO que nao ha endereco quando ela nao sabe.
      setEnderecosErro(!!error);
      setEnderecos(data ?? []);
    } else {
      setEnderecosErro(false);
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
        const { error: perfErr } = await supabase.from("profiles")
          .update({ nome: profile.nome, telefone: profile.telefone }).eq("user_id", profileUserId);
        if (perfErr) {
          setSaving(false);
          toast.error("Could not save your profile: " + perfErr.message);
          return;
        }
      }
    }

    // Esta e a que importa: e a ficha que o pedido usa. Antes as DUAS escritas
    // tinham o erro descartado, e o cliente saia achando que tinha atualizado o
    // telefone de contato do pedido dele.
    const { error: cliErr } = await supabase.from("clientes")
      .update({ nome: profile.nome, telefone: profile.telefone }).eq("id", cliente.id);
    setSaving(false);
    if (cliErr) {
      toast.error("Could not save your details: " + cliErr.message);
      return;
    }
    toast.success("Profile updated");
    fetchData();
  };

  const handleAddEndereco = async () => {
    if (!cliente) return;
    const r = await adicionarEndereco(supabase, cliente, newEnd);
    if (!r.ok) {
      toast.error(r.motivo === "incompleto" ? "Fill in street, city, state and ZIP." : r.mensagem);
      return;
    }
    setAddOpen(false);
    setNewEnd({ logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "", cep: "" });
    toast.success("Address added");
    fetchData();
  };

  const handleDeleteEndereco = async (id: string) => {
    const r = await removerEndereco(supabase, id);
    if (!r.ok) {
      // O endereco continuava na lista depois do F5 e o cliente nao entendia
      // por que. Pior: podia acabar usando o endereco antigo num pedido.
      toast.error(r.motivo === "erro"
        ? "Could not remove the address: " + r.mensagem
        : "The address was not removed. You may not have permission to remove it, or it no longer exists.");
      // Zero linhas: alguem ja removeu, ou a RLS barrou. Reler poe a lista de
      // acordo com o banco em vez de deixar a tela discordando dele.
      if (r.motivo === "nada") fetchData();
      return;
    }
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
            {(() => {
              // Endereço PRINCIPAL: vem do cadastro do cliente (aba "Customer details"
              // no admin) — campos na tabela clientes. Antes o portal só lia a tabela
              // `enderecos` e esse endereço não aparecia.
              const c = cliente ?? {};
              const hasPrimary = !!(c.endereco || c.cidade || c.estado || c.cep);
              const line2 = [c.cidade, c.estado].filter(Boolean).join(", ");
              const line3 = [c.pais, c.cep].filter(Boolean).join(" ");
              // O aviso de falha vale mesmo quando existe endereco principal:
              // a lista sairia INCOMPLETA e o cliente concluiria que os
              // enderecos salvos sumiram.
              if (!hasPrimary && enderecos.length === 0 && !enderecosErro) {
                return <p className="text-sm text-muted-foreground">No addresses registered.</p>;
              }
              return (
                <div className="space-y-3">
                  {enderecosErro && (
                    <p className="text-sm text-destructive">Could not load your saved addresses. Please refresh the page.</p>
                  )}
                  {hasPrimary && (
                    <div className="flex items-start justify-between rounded-md border border-border/70 bg-background/40 p-3">
                      <div className="flex gap-2">
                        <MapPin className="mt-0.5 h-4 w-4 text-primary" />
                        <div className="text-sm">
                          <p className="font-medium">{c.endereco || "—"}{c.endereco2 ? `, ${c.endereco2}` : ""}</p>
                          {line2 && <p className="text-muted-foreground">{line2}</p>}
                          {line3 && <p className="text-muted-foreground">{line3}</p>}
                        </div>
                      </div>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Primary</span>
                    </div>
                  )}
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
              );
            })()}
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  );
};

export default Conta;
