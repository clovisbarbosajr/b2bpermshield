import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { gravarComToken } from "@/lib/gravarComToken";
import { ArrowLeft, Plus, Trash2, Pencil } from "lucide-react";
import { useActivityLog } from "@/hooks/useActivityLog";

const activityOptions = ["Other", "Contractor", "Retailer", "Wholesaler", "Distributor", "Manufacturer"];

const CustomerEdit = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { log } = useActivityLog();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Nomes das listas que FALHARAM ao carregar. Vazio = tudo ok, e por isso comeca
  // vazio: cliente NOVO nunca passa pelo bloco que preenche isto, e nascer travado
  // seria pior que o defeito.
  const [falhouCarregar, setFalhouCarregar] = useState<string[]>([]);
  const [cliente, setCliente] = useState<any>(null);
  // Token do bloqueio otimista — o `admin_rev` da versao que ESTA tela carregou.
  // Ver `src/lib/gravarComToken.ts`. `useRef` porque precisa valer ja na proxima
  // linha do mesmo handler, e um re-render nao pode ressuscitar token velho.
  const revRef = useRef<number | null>(null);
  // Gravacao cujo desfecho ficou DESCONHECIDO: a resposta se perdeu e o commit
  // pode ou nao ter acontecido. Trava o proximo save.
  const estadoIncertoRef = useRef(false);
  const [enderecos, setEnderecos] = useState<any[]>([]);
  const [tabelasPreco, setTabelasPreco] = useState<any[]>([]);
  const [taxGroups, setTaxGroups] = useState<any[]>([]);
  const [privacyGroups, setPrivacyGroups] = useState<any[]>([]);
  const [clientePrivacyGroups, setClientePrivacyGroups] = useState<string[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [shippingOptions, setShippingOptions] = useState<any[]>([]);
  const [paymentOptions, setPaymentOptions] = useState<any[]>([]);
  const [selectedPaymentOptions, setSelectedPaymentOptions] = useState<string[]>([]);
  const [selectedShippingOptions, setSelectedShippingOptions] = useState<string[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactForm, setContactForm] = useState({ nome: "", email: "", can_confirm_order: false, can_view_full_history: false });
  const [addingContact, setAddingContact] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [pedidos, setPedidos] = useState<any[]>([]);

  const [form, setForm] = useState({
    empresa: "", nome: "", email: "", telefone: "", activity: "", language: "English (US)",
    is_active: true, disable_ordering: false, discount: 0, minimum_order_value: "",
    admin_comments: "", tabela_preco_id: "", tax_customer_group_id: "",
    representante_id: "", parent_customer_id: "", can_confirm_order: false, can_view_full_history: false,
    endereco: "", endereco2: "", cidade: "", estado: "", pais: "United States", cep: "",
    website: "", company_number: "", customer_reference_code: "",
    billing_same_as_contact: true,
  });

  useEffect(() => { loadData(); }, [id]);

  const loadData = async () => {
    // `loading` de volta a true a CADA carregamento, nao so na montagem.
    //
    // Ele so nascia true e so virava false — entao, trocando de ficha SEM
    // remontar (o historico do navegador consegue pular de uma para outra), a
    // tela ficava interativa durante as idas ao servidor com o id JA do novo
    // registro e as listas ainda do anterior. Um Save nesse intervalo gravava as
    // listas de um em cima do outro, dizendo "saved".
    //
    // Isto NAO e o `falhouCarregar`: a trava de carregamento fica
    // intacta. So o spinner volta, e ele cobre a troca inteira.
    setLoading(true);

    const [
      { data: c },
      { data: tp },
      { data: tg },
      { data: pg },
      { data: r },
      { data: allClients },
      { data: so },
      { data: po },
    ] = await Promise.all([
      id ? supabase.from("clientes").select("*").eq("id", id).maybeSingle() : { data: null },
      supabase.from("tabelas_preco").select("*").eq("ativo", true).order("nome"),
      supabase.from("tax_customer_groups").select("*").order("nome"),
      supabase.from("privacy_groups").select("*").eq("ativo", true).order("nome"),
      supabase.from("representantes").select("*").eq("ativo", true).order("nome"),
      supabase.from("clientes").select("id, empresa, nome, email").order("empresa"),
      supabase.from("shipping_options").select("*").eq("ativo", true).order("ordem"),
      supabase.from("payment_options").select("*").eq("ativo", true).order("ordem"),
    ]);

    setTabelasPreco(tp ?? []);
    setTaxGroups(tg ?? []);
    setPrivacyGroups(pg ?? []);
    setReps(r ?? []);
    setClientes((allClients ?? []).filter((cl: any) => cl.id !== id));
    setShippingOptions(so ?? []);
    setPaymentOptions(po ?? []);

    if (c) {
      setCliente(c);
      revRef.current = (c as any).admin_rev ?? null;
      // A incerteza morre com a ficha a que pertencia: trocar de cliente sem
      // remontar nao pode herdar a trava do anterior.
      estadoIncertoRef.current = false;
      setForm({
        empresa: c.empresa || "", nome: c.nome || "", email: c.email || "",
        telefone: c.telefone || "", activity: c.activity || "",
        language: c.language || "English (US)", is_active: c.is_active ?? true,
        disable_ordering: c.disable_ordering ?? false, discount: c.discount ?? 0,
        minimum_order_value: c.minimum_order_value?.toString() || "",
        admin_comments: c.admin_comments || "", tabela_preco_id: c.tabela_preco_id || "",
        tax_customer_group_id: c.tax_customer_group_id || "",
        representante_id: c.representante_id || "", parent_customer_id: c.parent_customer_id || "",
        can_confirm_order: (c as any).can_confirm_order ?? false, can_view_full_history: (c as any).can_view_full_history ?? false,
        endereco: c.endereco || "", endereco2: c.endereco2 || "", cidade: c.cidade || "",
        estado: c.estado || "", pais: c.pais || "United States", cep: c.cep || "",
        website: c.website || "", company_number: c.company_number || "",
        customer_reference_code: c.customer_reference_code || "",
        billing_same_as_contact: c.billing_same_as_contact ?? true,
      });

      // Load privacy groups
      const { data: cpg, error: errCpg } = await supabase.from("cliente_privacy_groups").select("privacy_group_id").eq("cliente_id", id!);
      setClientePrivacyGroups((cpg ?? []).map((x: any) => x.privacy_group_id));

      // Load addresses
      const { data: addrs } = await supabase.from("enderecos").select("*").eq("cliente_id", id!).order("created_at");
      setEnderecos(addrs ?? []);

      // Load selected payment/shipping options for this customer
      const [{ data: cpo, error: errCpo }, { data: cso, error: errCso }] = await Promise.all([
        supabase.from("cliente_payment_options").select("payment_option_id").eq("cliente_id", id!),
        supabase.from("cliente_shipping_options").select("shipping_option_id").eq("cliente_id", id!),
      ]);
      setSelectedPaymentOptions((cpo ?? []).map((x: any) => x.payment_option_id));
      setSelectedShippingOptions((cso ?? []).map((x: any) => x.shipping_option_id));

      // SE ALGUMA DESTAS TRES FALHOU, A TELA RECUSA SALVAR.
      //
      // Sao exatamente as tres listas que o `regravaLista` APAGA E REESCREVE a
      // partir do estado da tela. O erro nem chegava a ser destruturado: a leitura
      // falhava, a lista ficava vazia, o save apagava tudo e dizia "Customer
      // saved".
      //
      // E o estrago e SILENCIOSO ate o fim: a opcao privada some do seletor do
      // checkout (`Checkout.tsx` filtra o que o cliente nao pode ver) e o produto
      // privado some do portal. NAO conte com `PAYMENT_OPTION_NOT_ALLOWED` no log
      // para descobrir — o gatilho do banco so recusa quando o cliente MANDA o id
      // proibido, o que exige uma aba de checkout aberta ANTES do apagamento.
      //
      // So dentro do `if (c)`: cliente NOVO nao tem lista nenhuma para perder, e
      // travar a criacao por causa disso seria pior que o defeito.
      //
      // RESSALVA: RLS negando um SELECT devolve [] com HTTP 200 e SEM `error`.
      // Esta guarda cobre rede, timeout e 5xx — nao cobre RLS.
      const falhas = [
        ["privacy groups", errCpg], ["payment options", errCpo], ["shipping options", errCso],
      ].filter(([, e]) => e) as [string, { message: string }][];
      setFalhouCarregar(falhas.map(([n]) => n));
      if (falhas.length > 0) {
        toast.error(`Could not load: ${falhas.map(([n]) => n).join(", ")}. Saving is blocked — reload the page.`);
      }

      // Load sub-users (modelo B2BWave: clientes filhos com parent_customer_id)
      const { data: cts } = await supabase.from("clientes")
        .select("id, nome, email, can_confirm_order, can_view_full_history, status, user_id")
        .eq("parent_customer_id", id!).order("created_at");
      setContacts((cts ?? []).map((c: any) => ({ ...c, ativo: c.status !== "inativo" })));

      // Load orders
      const { data: orders } = await supabase.from("pedidos").select("*").eq("cliente_id", id!).order("created_at", { ascending: false }).limit(20);
      setPedidos(orders ?? []);
    }

    setLoading(false);
  };

  const handleSave = async (goBack = false) => {
    // A gravacao anterior ficou sem resposta: nao da para tentar de novo as cegas.
    // Se ela commitou, o token da tela ja nao vale e o proximo save acusaria de
    // conflito um colega que nao existe.
    if (estadoIncertoRef.current) {
      toast.error("Nothing was saved: the previous save never came back, so it may or may not have gone through. Reload the page and check before saving again.");
      return;
    }

    setSaving(true);

    let userId = cliente?.user_id;

    // New customer: create auth user first, then insert cliente
    if (!cliente?.id) {
      if (!form.email) {
        toast.error("Email is required to create a customer");
        setSaving(false);
        return;
      }

      const { data: fnData, error: fnError } = await supabase.functions.invoke("admin-create-user", {
        body: {
          email: form.email,
          nome: form.nome || form.empresa || "",
          empresa: form.empresa || "",
        },
      });

      if (fnError || fnData?.error) {
        toast.error(fnData?.error || fnError?.message || "Error creating auth user");
        setSaving(false);
        return;
      }

      userId = fnData.user_id;

      // Trigger no longer creates clientes — insert directly
      const payload = buildPayload(userId);
      const { data: newCliente, error: insertError } = await supabase
        .from("clientes")
        .insert({ ...payload, status: "ativo", is_active: true })
        .select("id")
        .single();

      if (insertError || !newCliente) {
        toast.error(insertError?.message || "Error creating customer record");
        setSaving(false);
        return;
      }

      // Assign 'cliente' role so user can log in to portal immediately
      await supabase
        .from("user_roles")
        .upsert({ user_id: userId, role: "cliente" }, { onConflict: "user_id" });

      try {
        await syncPrivacyGroups(newCliente.id);
        await syncPaymentOptions(newCliente.id);
        await syncShippingOptions(newCliente.id);
      } catch (e: any) {
        // A ficha FOI criada; o que falhou foi uma das listas. Dizer as duas
        // coisas, senao o usuario refaz o cadastro inteiro e cria duplicata.
        setSaving(false);
        toast.error(`Customer created, but a list failed to save — ${e?.message ?? e}`);
        log("created", "customer", newCliente.id, form.empresa || form.nome);
        navigate(`/admin/customers/${newCliente.id}`);
        return;
      }
      setSaving(false);
      toast.success("Customer created with login access");
      log("created", "customer", newCliente.id, form.empresa || form.nome);
      navigate(`/admin/customers/${newCliente.id}`);
      return;
    }

    // Bloqueio: as tres listas abaixo sao apagadas e reescritas a partir do
    // estado da tela, e o estado esta incompleto.
    if (falhouCarregar.length > 0) {
      setSaving(false);
      toast.error(`Nothing was saved: ${falhouCarregar.join(", ")} failed to load. Reload the page and try again.`);
      return;
    }

    // Existing customer: update
    // `as any`: `buildPayload` monta `status` como `string`, e o type gerado espera
    // o enum ("ativo" | "inativo" | "pendente"). O valor vem de um <Select> com
    // essas opções — é o TYPE que é mais estreito que o formulário.
    const payload = buildPayload(userId!) as any;

    // BLOQUEIO OTIMISTA — mesmo defeito medido na tela de produto, mesma solucao.
    //
    // As tres listas abaixo (`syncPrivacyGroups`, `syncPaymentOptions`,
    // `syncShippingOptions`) sao APAGADAS E REESCRITAS a partir do estado da TELA.
    // Com dois admins na mesma ficha, o segundo a salvar apaga o trabalho do
    // primeiro e os DOIS leem "Customer saved". No produto isso foi medido contra
    // o banco (`docs/ESTRESSE-SAVE-PRODUTO.sql`); aqui a mecanica e identica, e o
    // estrago e pior: grupo de privacidade e opcao de pagamento decidem o que o
    // cliente VE e COMO ele paga.
    //
    // A funcao e a mesma do produto, com a tabela por parametro — ela levou sete
    // rodadas de revisao para ficar certa, e uma copia divergiria.
    if (revRef.current === null) {
      // `=== null` e nao `!revRef.current`: `admin_rev` comeca em ZERO e zero e
      // falsy. Testar a verdade travaria o save de TODO cliente ja cadastrado.
      setSaving(false);
      toast.error("Nothing was saved: this customer's version is unknown. Reload the page and try again.");
      return;
    }
    const r = await gravarComToken(supabase, "clientes", cliente.id, payload, revRef.current);
    if (r.tipo === "recusado") {
      // O PostgREST respondeu com `code`: a transacao abortou, nada foi escrito e o
      // token continua valendo. Corrigir o campo e salvar de novo funciona.
      toast.error(r.mensagem);
      setSaving(false);
      return;
    }
    if (r.tipo === "incerto") {
      estadoIncertoRef.current = true;
      toast.error(`${r.mensagem} — the save may or may not have gone through. Reload the page and check before trying again.`);
      setSaving(false);
      return;
    }
    if (r.tipo === "conflito") {
      // Zero linhas tem duas causas: token velho, ou o cliente foi APAGADO. Recusa
      // ANTES das tres listas — sao elas que destroem.
      setSaving(false);
      toast.error("Nothing was saved: this customer was changed or removed by someone else while you had it open. Reload the page before saving again.");
      return;
    }
    revRef.current = r.rev;

    try {
      await syncPrivacyGroups(cliente.id);
      await syncPaymentOptions(cliente.id);
      await syncShippingOptions(cliente.id);
    } catch (e: any) {
      // NAO cai no `toast.success`. Antes, os seis erros dessas tres funcoes
      // eram descartados e a tela dizia "Customer saved" com a lista vazia no
      // banco.
      setSaving(false);
      toast.error(String(e?.message ?? e));
      return;
    }
    setSaving(false);
    toast.success("Customer saved");
    log("updated", "customer", cliente.id, form.empresa || form.nome);
    if (goBack) navigate("/admin/customers");
  };

  const buildPayload = (userId: string) => ({
    empresa: form.empresa || "",
    nome: form.nome || "",
    email: form.email || "",
    telefone: form.telefone || null,
    activity: form.activity || null,
    language: form.language,
    // Mantém `status` E `is_active` COERENTES com o "Is active" — senão reativar
    // um removido só mexia no is_active e o Team (status==="inativo") seguia
    // "Removed". Pendente/rejeitado: NÃO toca em NENHUM dos dois (fluxo de
    // aprovação — senão um rejeitado salvava como is_active=true e aparecia
    // ativo na lista/filtro).
    ...((() => {
      const cur = cliente?.status;
      if (cur === "pendente" || cur === "rejeitado") return {};
      return { status: form.is_active ? "ativo" : "inativo", is_active: form.is_active };
    })()),
    disable_ordering: form.disable_ordering,
    discount: form.discount,
    // `parseFloat("abc")` e NaN, e `JSON.stringify(NaN)` vira `null` — digitar
    // qualquer coisa no campo APAGAVA o pedido minimo e a tela dizia "salvo".
    // O input e texto puro, entao lixo entra facil.
    minimum_order_value: (() => {
      const bruto = String(form.minimum_order_value ?? "").trim();
      if (bruto === "") return null;
      const v = Number(bruto);
      return Number.isFinite(v) && v >= 0 ? v : null;
    })(),
    admin_comments: form.admin_comments || null,
    tabela_preco_id: form.tabela_preco_id && form.tabela_preco_id !== '__none__' ? form.tabela_preco_id : null,
    tax_customer_group_id: form.tax_customer_group_id && form.tax_customer_group_id !== '__none__' ? form.tax_customer_group_id : null,
    representante_id: form.representante_id && form.representante_id !== '__none__' ? form.representante_id : null,
    parent_customer_id: form.parent_customer_id && form.parent_customer_id !== '__none__' ? form.parent_customer_id : null,
    can_confirm_order: !!form.can_confirm_order,
    can_view_full_history: !!form.can_view_full_history,
    endereco: form.endereco || null,
    endereco2: form.endereco2 || null,
    cidade: form.cidade || null,
    estado: form.estado || null,
    pais: form.pais || null,
    cep: form.cep || null,
    website: form.website || null,
    company_number: form.company_number || null,
    customer_reference_code: form.customer_reference_code || null,
    billing_same_as_contact: form.billing_same_as_contact,
    user_id: userId,
  });

  // As tres listas abaixo eram "apaga tudo e reinsere", com os SEIS erros
  // descartados. Se o delete passava e o insert falhava, a lista ficava VAZIA no
  // banco, o estado continuava em memoria (some no F5), e a tela dizia
  // "Customer saved".
  //
  // Nestas tres, lista vazia significa RESTRICAO, nao liberacao: o cliente perde
  // os grupos de privacidade, as formas de pagamento privadas (Zelle, wire, Pay
  // Later) e os fretes negociados. Ou seja, o cliente para de conseguir comprar
  // do jeito combinado — e ninguem sabe por que.
  //
  // `throw` de proposito, e os DOIS pontos de chamada envolvem em try/catch (ver
  // `handleSave`): o erro de verdade aparece, em vez de o fluxo seguir para o
  // `toast.success`.
  const regravaLista = async (
    tabela: string,
    colunaCliente: string,
    colunaItem: string,
    customerId: string,
    ids: string[],
    rotulo: string,
  ) => {
    const { error: delErr } = await supabase.from(tabela as any).delete().eq(colunaCliente, customerId);
    if (delErr) throw new Error(`${rotulo}: ${delErr.message}`);
    if (ids.length === 0) return;
    const { error: insErr } = await supabase.from(tabela as any).insert(
      ids.map((id) => ({ [colunaCliente]: customerId, [colunaItem]: id })) as any,
    );
    if (insErr) {
      // O delete ja passou. Dizer isso na cara, em vez de deixar o usuario achar
      // que nada mudou.
      throw new Error(`${rotulo}: ${insErr.message} — a lista anterior foi apagada, refaca a selecao e salve de novo.`);
    }
  };

  const syncPrivacyGroups = (customerId: string) =>
    regravaLista("cliente_privacy_groups", "cliente_id", "privacy_group_id", customerId, clientePrivacyGroups, "Privacy groups");

  const syncPaymentOptions = (customerId: string) =>
    regravaLista("cliente_payment_options", "cliente_id", "payment_option_id", customerId, selectedPaymentOptions, "Payment options");

  const syncShippingOptions = (customerId: string) =>
    regravaLista("cliente_shipping_options", "cliente_id", "shipping_option_id", customerId, selectedShippingOptions, "Shipping options");

  const togglePrivacyGroup = (pgId: string) => {
    setClientePrivacyGroups(prev =>
      prev.includes(pgId) ? prev.filter(x => x !== pgId) : [...prev, pgId]
    );
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </AdminLayout>
    );
  }

  if (!cliente && id && id !== "new") {
    return (
      <AdminLayout>
        <div className="py-20 text-center">
          <h2 className="text-xl font-semibold">Customer not found</h2>
          <Button variant="link" onClick={() => navigate("/admin/customers")}>Back to Customers</Button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      {/* Header */}
      {cliente?.id && (
        <div className="mb-4 flex items-center gap-3">
          <span className="inline-flex items-center gap-1 rounded bg-primary/20 px-3 py-1 text-xs font-medium text-primary">
            {cliente.empresa || cliente.nome} ✕
          </span>
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">{cliente?.id ? `Editing customer: ${cliente.empresa || cliente.nome}` : "Create customer"}</h2>
        {cliente?.id && (
          <Button variant="outline" size="sm" onClick={() => navigate(`/admin/customers/${cliente.id}`)}>
            <Pencil className="h-4 w-4 mr-1" /> Edit all
          </Button>
        )}
      </div>

      {/* Faixa fixa, fora das abas: o toast some e depois nao sobra sinal
          nenhum — as abas passam a mostrar as listas VAZIAS como se o cliente
          nao tivesse nenhuma opcao selecionada. */}
      {falhouCarregar.length > 0 && (
        <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm font-semibold text-destructive">
            Saving is blocked — this customer's data did not load completely.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Failed to load: {falhouCarregar.join(", ")}. The lists below are incomplete,
            and saving would erase them. Reload the page.
          </p>
        </div>
      )}

      <Tabs defaultValue="details" className="space-y-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="details">Customer details</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="addresses">Addresses</TabsTrigger>
          <TabsTrigger value="sales-rep">Sales Rep</TabsTrigger>
          <TabsTrigger value="email-settings">Email Settings</TabsTrigger>
          <TabsTrigger value="homepage-products">Customer homepage products</TabsTrigger>
          <TabsTrigger value="payment-options">Payment options</TabsTrigger>
          <TabsTrigger value="shipping-options">Customer shipping options</TabsTrigger>
          <TabsTrigger value="admin-fields">Admin fields</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
        </TabsList>

        {/* Customer Details Tab */}
        <TabsContent value="details">
          <Card className="p-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left column */}
              <div className="space-y-4">
                <div><Label>Company name</Label><Input value={form.empresa} onChange={e => setForm(f => ({ ...f, empresa: e.target.value }))} /></div>
                <div><Label>Full Name</Label><Input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Activity</Label>
                    <Select value={form.activity} onValueChange={v => setForm(f => ({ ...f, activity: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                      <SelectContent>
                        {activityOptions.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Specify activity</Label><Input /></div>
                </div>
                <div><Label>Email</Label><Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
                <div className="flex gap-2">
                  <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700 text-white" type="button"
                    disabled={!cliente?.id}
                    onClick={async () => {
                      if (!form.email) { toast.error("No email"); return; }
                      const { error } = await supabase.functions.invoke("send-email", {
                        body: { type: "password_reset", email: form.email.trim().toLowerCase(), redirectTo: `${window.location.origin}/reset-password` },
                      });
                      if (error) toast.error(error.message);
                      else toast.success(`Reset password link sent to ${form.email}`);
                    }}>🔒 Send reset password link</Button>
                  <Button size="sm" className="gap-1 bg-blue-600 hover:bg-blue-700 text-white" type="button"
                    disabled={!cliente?.id}
                    onClick={async () => {
                      if (!form.email) { toast.error("No email"); return; }
                      // Server-side: provisiona o auth user se faltar (cliente migrado do B2BWave).
                      const { error } = await supabase.functions.invoke("send-email", {
                        body: { type: "request_magic_link", email: form.email.trim().toLowerCase(), redirectTo: window.location.origin },
                      });
                      if (error) toast.error(error.message);
                      else toast.success(`One-time login link sent to ${form.email}`);
                    }}>🔑 Send one-time login link</Button>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: !!v }))} /> Is active
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.disable_ordering} onCheckedChange={v => setForm(f => ({ ...f, disable_ordering: !!v }))} /> Disable Ordering
                  </label>
                </div>
                <div>
                  <Label>Language</Label>
                  <Select value={form.language} onValueChange={v => setForm(f => ({ ...f, language: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="English (US)">English (US)</SelectItem>
                      <SelectItem value="Spanish">Spanish</SelectItem>
                      <SelectItem value="Portuguese">Portuguese</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Sales Tax group *</Label>
                  <Select value={form.tax_customer_group_id} onValueChange={v => setForm(f => ({ ...f, tax_customer_group_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="No Sales Tax" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No Sales Tax</SelectItem>
                      {taxGroups.map(t => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Price List</Label>
                  <Select value={form.tabela_preco_id} onValueChange={v => setForm(f => ({ ...f, tabela_preco_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {tabelasPreco.map(t => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {/* CAMPO REMOVIDO DA TELA em 25/ago/2026, por decisao do dono.
                  *
                  * `clientes.discount` NUNCA foi aplicado a preco nenhum: nao e
                  * lido por gatilho, nem pelo checkout, nem por `pricing.ts`.
                  * Era um controle que o dono acreditava ter — o pior tipo de
                  * tela fantasma, porque ele acha que deu 10% e nao deu.
                  *
                  * A COLUNA CONTINUA NO BANCO e continua sendo sincronizada do
                  * B2BWave (`b2bwave-sync`), entao nenhum dado se perde e a
                  * migracao de volta e so descomentar isto.
                  *
                  * PARA VOLTAR: descomente este bloco E implemente a aplicacao
                  * do desconto no servidor (`fn_pedido_total_appside` e
                  * `preco_autoritativo`). Sem a segunda parte, volta a ser
                  * fantasma.
                  *
                  * <div>
                  *   <Label>Discount</Label>
                  *   <div className="flex items-center gap-1">
                  *     <Input type="number" value={form.discount} onChange={e => setForm(f => ({ ...f, discount: parseFloat(e.target.value) || 0 }))} className="max-w-[100px]" />
                  *     <span className="text-sm text-muted-foreground">%</span>
                  *   </div>
                  * </div>
                  */}
                <div><Label>Minimum order value</Label><Input value={form.minimum_order_value} onChange={e => setForm(f => ({ ...f, minimum_order_value: e.target.value }))} /></div>
                <div><Label>Phone</Label><Input value={form.telefone} onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))} /></div>
                <div><Label>Admin comments</Label><Textarea value={form.admin_comments} onChange={e => setForm(f => ({ ...f, admin_comments: e.target.value }))} rows={3} /></div>
              </div>

              {/* Right column */}
              <div className="space-y-4">
                <div><Label>Address</Label><Input value={form.endereco} onChange={e => setForm(f => ({ ...f, endereco: e.target.value }))} /></div>
                <div><Label>Address Line 2</Label><Input value={form.endereco2} onChange={e => setForm(f => ({ ...f, endereco2: e.target.value }))} /></div>
                <div><Label>City</Label><Input value={form.cidade} onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))} /></div>
                <div><Label>State</Label><Input value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))} /></div>
                <div>
                  <Label>Country</Label>
                  <Select value={form.pais} onValueChange={v => setForm(f => ({ ...f, pais: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="United States">United States</SelectItem>
                      <SelectItem value="Canada">Canada</SelectItem>
                      <SelectItem value="United Kingdom">United Kingdom</SelectItem>
                      <SelectItem value="Brazil">Brazil</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Postal code</Label><Input value={form.cep} onChange={e => setForm(f => ({ ...f, cep: e.target.value }))} /></div>
                <div><Label>Website</Label><Input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} /></div>
                <div><Label>Company number</Label><Input value={form.company_number} onChange={e => setForm(f => ({ ...f, company_number: e.target.value }))} /></div>
                <div><Label>Customer reference code</Label><Input value={form.customer_reference_code} onChange={e => setForm(f => ({ ...f, customer_reference_code: e.target.value }))} /></div>
                <div>
                  <Label>Parent customer</Label>
                  <Select value={form.parent_customer_id} onValueChange={v => setForm(f => ({ ...f, parent_customer_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Please select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {clientes.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.empresa} {c.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Permissões de sub-customer (modelo B2BWave) — só fazem sentido com um pai. */}
                  {form.parent_customer_id && form.parent_customer_id !== '__none__' && (
                    <div className="mt-3 space-y-2 rounded-md border border-border p-3 bg-muted/20">
                      <p className="text-xs font-semibold text-muted-foreground">Sub-customer permissions</p>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={form.can_confirm_order}
                          onChange={e => setForm(f => ({ ...f, can_confirm_order: e.target.checked }))} />
                        Can confirm order without approval
                        <span className="text-xs text-muted-foreground">(off = can't place orders; the parent does)</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={form.can_view_full_history}
                          onChange={e => setForm(f => ({ ...f, can_view_full_history: e.target.checked }))} />
                        Can view full history
                        <span className="text-xs text-muted-foreground">(off = sees only their own orders)</span>
                      </label>
                    </div>
                  )}
                </div>
                <div>
                  <Label>Privacy groups</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {clientePrivacyGroups.map(pgId => {
                      const pg = privacyGroups.find(g => g.id === pgId);
                      return pg ? (
                        <Badge key={pgId} variant="secondary" className="gap-1 cursor-pointer" onClick={() => togglePrivacyGroup(pgId)}>
                          ✕ {pg.nome}
                        </Badge>
                      ) : null;
                    })}
                  </div>
                  <Select onValueChange={v => { if (v && !clientePrivacyGroups.includes(v)) togglePrivacyGroup(v); }}>
                    <SelectTrigger className="mt-2"><SelectValue placeholder="Add group..." /></SelectTrigger>
                    <SelectContent>
                      {privacyGroups.filter(g => !clientePrivacyGroups.includes(g.id)).map(g => (
                        <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Billing Tab */}
        <TabsContent value="billing">
          <Card className="p-6">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.billing_same_as_contact} onCheckedChange={v => setForm(f => ({ ...f, billing_same_as_contact: !!v }))} />
              Same as contact details
            </label>
          </Card>
        </TabsContent>

        {/* Addresses Tab */}
        <TabsContent value="addresses">
          <Card className="p-6">
            <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              ⚠ Editar os campos de um endereço existente abaixo não salva (só leitura). Use <strong>Add Address</strong> / a lixeira para adicionar/remover; o cliente edita os próprios endereços no portal (My Account).
            </div>
            <div className="mb-4">
              <Label className="text-sm">Allow ordering from countries</Label>
              <div className="border rounded p-2 h-24 overflow-y-auto text-sm text-muted-foreground mt-1">
                United Kingdom<br />United States<br />Canada<br />Australia<br />Brazil
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead>City / State</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Postal code</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {enderecos.map(addr => (
                  <TableRow key={addr.id}>
                    <TableCell>
                      <Input defaultValue={addr.logradouro} className="mb-1" />
                      <Input defaultValue={addr.complemento || ""} placeholder="Address line 2" />
                    </TableCell>
                    <TableCell>
                      <Input defaultValue={addr.cidade} className="mb-1" />
                      <Input defaultValue={addr.estado} />
                    </TableCell>
                    <TableCell>
                      <Select defaultValue="United States">
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="United States">United States</SelectItem>
                          <SelectItem value="Canada">Canada</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input defaultValue={addr.cep} /></TableCell>
                    <TableCell><Checkbox defaultChecked={addr.principal} /></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={async () => {
                        await supabase.from("enderecos").delete().eq("id", addr.id);
                        setEnderecos(prev => prev.filter(a => a.id !== addr.id));
                      }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button size="sm" className="mt-3 gap-1" onClick={async () => {
              const { data } = await supabase.from("enderecos").insert({
                cliente_id: cliente.id, logradouro: "", cidade: "", estado: "", cep: ""
              }).select().single();
              if (data) setEnderecos(prev => [...prev, data]);
            }}>
              <Plus className="h-4 w-4" /> Add Address
            </Button>
          </Card>
        </TabsContent>

        {/* Sales Rep Tab */}
        <TabsContent value="sales-rep">
          <Card className="p-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sales Rep</TableHead>
                  <TableHead>Commission</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {form.representante_id && reps.find(r => r.id === form.representante_id) && (
                  <TableRow>
                    <TableCell>{reps.find(r => r.id === form.representante_id)?.nome}</TableCell>
                    <TableCell>{reps.find(r => r.id === form.representante_id)?.comissao_percentual}%</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setForm(f => ({ ...f, representante_id: "" }))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <div className="mt-3 flex gap-2">
              <Select value="" onValueChange={v => setForm(f => ({ ...f, representante_id: v }))}>
                <SelectTrigger className="max-w-xs"><SelectValue placeholder="Add Sales Rep..." /></SelectTrigger>
                <SelectContent>
                  {reps.map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </Card>
        </TabsContent>

        {/* Email Settings Tab */}
        <TabsContent value="email-settings">
          <Card className="p-6 space-y-5">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              ⚠ Display only — these per-customer email fields are not saved yet. Global email settings apply (Settings → Email).
            </div>
            <p className="text-sm text-muted-foreground">Email notification settings for this customer. Configurations are inherited from the global settings.</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div><Label>Attach new order cc .xls file</Label><Input placeholder="" className="mt-1" /></div>
              <div><Label>Attach new order cc .txt file</Label><Input placeholder="" className="mt-1" /></div>
              <div><Label>Email for new order notification</Label><Input placeholder="" className="mt-1" /></div>
              <div>
                <Label>Add multiple emails split with commas</Label>
                <Input placeholder="e.g. joe.darling@belocore.com,info@belocore.com" className="mt-1" />
              </div>
              <div><Label>Email file location</Label><Input placeholder="" className="mt-1" /></div>
            </div>
            <div className="space-y-3 pt-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox /> Receive email notifications
              </label>
              <div>
                <Label className="text-sm">Bcc outgoing emails to customers</Label>
                <Input placeholder="" className="mt-1" />
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Customer homepage products */}
        <TabsContent value="homepage-products">
          <Card className="p-6">
            <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              ⚠ Not available yet — this section is display only and does not save.
            </div>
            <p className="text-sm text-muted-foreground mb-4">Configure products that appear on this customer's homepage. Select a product from the list and/or enter a free text query.</p>
            <div className="mb-4">
              <Label className="text-sm">Only show</Label>
              <Input className="mt-1 max-w-[200px]" placeholder="" />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-4">No products configured</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <Button size="sm" className="mt-3 gap-1 bg-green-600 hover:bg-green-700 text-white">
              <Plus className="h-4 w-4" /> Add a product
            </Button>
          </Card>
        </TabsContent>

        {/* Payment options */}
        <TabsContent value="payment-options">
          <Card className="p-6">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 mb-4">
              <p className="text-sm text-amber-200">Select the payment options available to this customer. If none are selected, the customer will have access to all active payment options configured in your global settings.</p>
            </div>
            <div className="space-y-3">
              {paymentOptions.map(po => (
                <div key={po.id} className="space-y-1">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={selectedPaymentOptions.includes(po.id)}
                      onCheckedChange={v => setSelectedPaymentOptions(prev =>
                        v ? [...prev, po.id] : prev.filter(id => id !== po.id)
                      )}
                    />
                    {po.nome}
                  </label>
                </div>
              ))}
              {paymentOptions.length === 0 && (
                <p className="text-sm text-muted-foreground">No payment options configured. Add them in Settings → Payment Options.</p>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* Shipping options */}
        <TabsContent value="shipping-options">
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-4">Configure available shipping options for this customer.</p>
            <div className="space-y-3">
              {shippingOptions.map(so => (
                <label key={so.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={selectedShippingOptions.includes(so.id)}
                    onCheckedChange={v => setSelectedShippingOptions(prev =>
                      v ? [...prev, so.id] : prev.filter(id => id !== so.id)
                    )}
                  />
                  {so.nome}
                </label>
              ))}
              {shippingOptions.length === 0 && (
                <p className="text-sm text-muted-foreground">No shipping options configured. Add them in Settings → Shipping Options.</p>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* Admin fields */}
        <TabsContent value="admin-fields">
          <Card className="p-6">
            <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              ⚠ Not available yet — this section is display only and does not save.
            </div>
            <p className="text-sm text-muted-foreground mb-4">Custom admin fields for this customer.</p>
            <div className="space-y-4">
              <div>
                <Label>CERTIFIED B2 EXPERT</Label>
                <Select>
                  <SelectTrigger className="mt-1 max-w-[200px]"><SelectValue placeholder="No" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Sub-users Tab (modelo B2BWave: funcionários = clientes filhos com 2 permissões) */}
        <TabsContent value="contacts">
          <Card className="p-6">
            <div className="mb-4">
              <p className="text-sm text-muted-foreground">
                Employees (sub-users) are additional logins for this company. Each one has their own email/password,
                shares this account's price list and catalog, and has two permissions: confirm orders without approval,
                and view the full company order history.
              </p>
            </div>

            {contacts.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-center">Confirm orders</TableHead>
                    <TableHead className="text-center">Full history</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map(ct => (
                    <TableRow key={ct.id}>
                      <TableCell>{ct.nome}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{ct.email}</TableCell>
                      <TableCell className="text-center">
                        {/* Checa o erro ANTES de marcar na tela. Sem isso, uma gravação
                            barrada (RLS/rede) deixava o admin vendo a permissão ligada
                            enquanto no banco ela continuava desligada — e "pode confirmar
                            pedido" é justamente o que libera o funcionário a comprar. */}
                        <Checkbox checked={ct.can_confirm_order} onCheckedChange={async (v) => {
                          const val = v === true;
                          const { error } = await supabase.from("clientes").update({ can_confirm_order: val }).eq("id", ct.id);
                          if (error) { toast.error("Could not change permission: " + error.message); return; }
                          setContacts(prev => prev.map(c => c.id === ct.id ? { ...c, can_confirm_order: val } : c));
                        }} />
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox checked={ct.can_view_full_history} onCheckedChange={async (v) => {
                          const val = v === true;
                          const { error } = await supabase.from("clientes").update({ can_view_full_history: val }).eq("id", ct.id);
                          if (error) { toast.error("Could not change permission: " + error.message); return; }
                          setContacts(prev => prev.map(c => c.id === ct.id ? { ...c, can_view_full_history: val } : c));
                        }} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={ct.ativo ? "default" : "secondary"} className="cursor-pointer"
                          onClick={async () => {
                            const next = ct.ativo ? "inativo" : "ativo";
                            const { error } = await supabase.from("clientes").update({ status: next, is_active: !ct.ativo }).eq("id", ct.id);
                            if (error) { toast.error("Could not change status: " + error.message); return; }
                            setContacts(prev => prev.map(c => c.id === ct.id ? { ...c, ativo: !c.ativo } : c));
                          }}>
                          {ct.ativo ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Send reset password"
                          onClick={async () => {
                            const { error } = await supabase.functions.invoke("send-email", {
                              body: { type: "password_reset", email: ct.email.trim().toLowerCase(), redirectTo: `${window.location.origin}/reset-password` },
                            });
                            if (error) toast.error(error.message);
                            else toast.success(`Reset link sent to ${ct.email}`);
                          }}>
                          🔒
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Set password manually (bypass — no email needed)"
                          onClick={async () => {
                            const pwd = prompt(`Set a password for ${ct.email} (min 6 chars).\nUse this when the setup email never arrived — tell them the password directly.`);
                            if (!pwd) return;
                            if (pwd.length < 6) { toast.error("Password must have at least 6 characters."); return; }
                            const { data, error } = await supabase.functions.invoke("admin-create-user", {
                              body: { action: "update_password", user_id: ct.user_id, new_password: pwd },
                            });
                            if (error || data?.error) toast.error(data?.error || error?.message);
                            else toast.success(`Password set for ${ct.email} — they can log in now.`);
                          }}>
                          🔑
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Delete permanently (frees the email for re-registration)"
                          onClick={async () => {
                            if (!confirm(`Permanently delete ${ct.email}?\nThis removes the employee AND the login — the email can be registered again from scratch.`)) return;
                            const { error: rowErr } = await supabase.from("clientes").delete().eq("id", ct.id);
                            if (rowErr) { toast.error(`Could not delete the employee record: ${rowErr.message}`); return; }
                            if (ct.user_id) {
                              const { data } = await supabase.functions.invoke("admin-create-user", {
                                body: { action: "delete_user", user_id: ct.user_id },
                              });
                              if (data?.error) { toast.warning(`Employee removed, but the login was kept: ${data.error}`); }
                            }
                            setContacts(prev => prev.filter(c => c.id !== ct.id));
                            toast.success(`${ct.email} deleted permanently.`);
                          }}>
                          🗑
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {addingContact ? (
              <div className="mt-4 rounded-lg border p-4 space-y-3">
                <h4 className="text-sm font-semibold">New employee</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Name</Label>
                    <Input value={contactForm.nome} onChange={e => setContactForm(f => ({ ...f, nome: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input type="email" value={contactForm.email} onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))} />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={contactForm.can_confirm_order} onCheckedChange={v => setContactForm(f => ({ ...f, can_confirm_order: v === true }))} />
                    Can confirm orders without approval
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={contactForm.can_view_full_history} onCheckedChange={v => setContactForm(f => ({ ...f, can_view_full_history: v === true }))} />
                    Can view the full company order history
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={savingContact} onClick={async () => {
                    if (!contactForm.nome || !contactForm.email) { toast.error("Name and email required"); return; }
                    if (!cliente?.id) { toast.error("Save the customer first"); return; }
                    setSavingContact(true);
                    // Cria o auth user
                    const { data: fnData, error: fnErr } = await supabase.functions.invoke("admin-create-user", {
                      body: { email: contactForm.email, nome: contactForm.nome, empresa: cliente.empresa || "" },
                    });
                    if (fnErr || fnData?.error) { toast.error(fnData?.error || fnErr?.message); setSavingContact(false); return; }
                    // Insere o sub-usuário: clientes filho com parent + 2 flags (herda price list via trigger)
                    const { data: ct, error: ctErr } = await supabase.from("clientes").insert({
                      user_id: fnData.user_id, parent_customer_id: cliente.id,
                      nome: contactForm.nome, email: contactForm.email, empresa: cliente.empresa || "",
                      can_confirm_order: contactForm.can_confirm_order, can_view_full_history: contactForm.can_view_full_history,
                      status: "ativo", is_active: true,
                    }).select("id, nome, email, can_confirm_order, can_view_full_history, status").single();
                    if (ctErr) { toast.error(ctErr.message); setSavingContact(false); return; }
                    // Papel 'cliente' apenas (nunca admin/manager/warehouse → sem escalonamento)
                    //
                    // O erro era descartado. Sem o papel, o funcionário RECEBE o
                    // e-mail para definir a senha, define, e não consegue entrar
                    // em lugar nenhum — e a tela dizia que estava tudo certo.
                    const { error: papelErr } = await supabase.from("user_roles")
                      .upsert({ user_id: fnData.user_id, role: "cliente" }, { onConflict: "user_id" });
                    if (papelErr) {
                      toast.error(`The employee record was created but the access role was not — they will not be able to log in: ${papelErr.message}`);
                      setSavingContact(false);
                      return;
                    }
                    // Envia DE VERDADE o link de definição de senha (Resend + Office365 fallback).
                    const { error: mailErr } = await supabase.functions.invoke("send-email", {
                      body: { type: "password_reset", email: contactForm.email.trim().toLowerCase(), redirectTo: `${window.location.origin}/reset-password` },
                    });
                    setContacts(prev => [...prev, { ...ct, ativo: true }]);
                    setContactForm({ nome: "", email: "", can_confirm_order: false, can_view_full_history: false });
                    setAddingContact(false);
                    setSavingContact(false);
                    toast.success(mailErr
                      ? `Employee ${contactForm.nome} created, but the setup email failed — use the 🔒 button to resend.`
                      : `Employee ${contactForm.nome} created. A setup email was sent to ${contactForm.email}.`);
                  }}>
                    {savingContact ? "Creating..." : "Create employee"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAddingContact(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" className="mt-4 gap-1" disabled={!cliente?.id}
                onClick={() => setAddingContact(true)}>
                <Plus className="h-4 w-4" /> Add employee
              </Button>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Bottom action bar */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate("/admin/customers")}>Back</Button>
          <Button size="sm" className="bg-primary" onClick={() => handleSave(true)} disabled={saving || falhouCarregar.length > 0}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => handleSave(false)} disabled={saving || falhouCarregar.length > 0}>
            Save and stay on page
          </Button>
        </div>
        {cliente?.id && (
          <div className="flex gap-2 flex-wrap">
            {cliente?.status === "pendente" && (
              <>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={async () => {
                  // Checa o erro ANTES de seguir: sem isso, uma aprovação barrada
                  // ainda dava papel de cliente, marcava "aprovado" na tela e
                  // DISPARAVA o e-mail de boas-vindas — o cliente recebia o aviso
                  // e continuava sem conseguir entrar.
                  const { error: apErr } = await supabase.from("clientes").update({ status: "ativo", is_active: true } as any).eq("id", cliente.id);
                  if (apErr) { toast.error("Could not approve: " + apErr.message); return; }
                  // Ensure user can log in to portal — add cliente role if not already set
                  if (cliente.user_id) {
                    // Mesmo caso: a ficha vira "ativo", mas sem o papel o cliente
                    // continua sem conseguir entrar. E a tela comemorava
                    // "Customer approved!" de qualquer jeito.
                    const { error: papelErr } = await (supabase.from("user_roles") as any).upsert(
                      { user_id: cliente.user_id, role: "cliente" },
                      { onConflict: "user_id" }
                    );
                    if (papelErr) {
                      toast.error(`Approved, but the access role failed — the customer still cannot log in: ${papelErr.message}`);
                      setCliente({ ...cliente, status: "ativo", is_active: true });
                      return;
                    }
                  }
                  setCliente({ ...cliente, status: "ativo", is_active: true });
                  toast.success("Customer approved!");
                  log("updated", "customer", cliente.id, cliente.empresa || cliente.nome, { action: "approved" });
                  // Se as notificações de email estiverem DESLIGADAS, o envio volta
                  // "skipped" — aí perguntamos se a admin quer enviar mesmo assim
                  // (force). Sem isso a conta aprovada ficava sem NENHUM email e a
                  // admin nem ficava sabendo.
                  supabase.functions.invoke("send-email", {
                    body: {
                      type: "approval",
                      customerEmail: cliente.email,
                      customerName: cliente.nome || cliente.empresa || "",
                      loginUrl: `${window.location.origin}/customers-login`,
                    },
                  }).then(async ({ data }) => {
                    if (data?.skipped) {
                      const sendAnyway = confirm(
                        "Email notifications are currently DISABLED (Settings → Notifications), so the approval email was NOT sent.\n\n" +
                        "OK = send it anyway just for this customer.\n" +
                        "Cancel = don't send (you can set their password manually in the Employees tab, or enable notifications and re-approve).",
                      );
                      if (sendAnyway) {
                        const { data: d2, error: e2 } = await supabase.functions.invoke("send-email", {
                          body: {
                            type: "approval", force: true,
                            customerEmail: cliente.email,
                            customerName: cliente.nome || cliente.empresa || "",
                            loginUrl: `${window.location.origin}/customers-login`,
                          },
                        });
                        if (e2 || d2?.error) toast.error(`Approval email failed: ${d2?.error || e2?.message}`);
                        else toast.success(`Approval email sent to ${cliente.email}.`);
                      }
                    }
                  }).catch(() => {});
                  supabase.functions.invoke("notify-dispatch", { body: { event: "account_approved", vars: {
                    customer_name: cliente.nome || cliente.empresa || "", customer_company: cliente.empresa ?? "",
                    customer_email: cliente.email ?? "", customer_phone: (cliente as any).telefone ?? "",
                  }, customer: { email: cliente.email, phone: (cliente as any).telefone, whatsapp: (cliente as any).telefone } } }).catch(() => {});
                }}>
                  ✓ Approve Customer
                </Button>
                <Button size="sm" variant="destructive" onClick={async () => {
                  if (!confirm("Reject this customer? They will receive a rejection email.")) return;
                  // Idem aprovação: sem checar, o e-mail de recusa saía mesmo com a
                  // gravação falhando — cliente recebia a recusa e continuava pendente.
                  const { error: rjErr } = await supabase.from("clientes").update({ status: "rejeitado", is_active: false } as any).eq("id", cliente.id);
                  if (rjErr) { toast.error("Could not reject: " + rjErr.message); return; }
                  setCliente({ ...cliente, status: "rejeitado", is_active: false });
                  toast.info("Customer rejected");
                  supabase.functions.invoke("send-email", {
                    body: {
                      type: "rejection",
                      customerEmail: cliente.email,
                      customerName: cliente.nome || cliente.empresa || "",
                    },
                  }).catch(() => {});
                }}>
                  ✗ Reject
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => navigate(`/admin/orders/new?customer=${cliente.id}`)}>
              Create Order
            </Button>
            <Button variant="outline" size="sm" className="gap-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => {
              navigate(`/admin/orders?customer=${cliente.id}`);
            }}>
              View all orders
            </Button>
          </div>
        )}
      </div>
    </AdminLayout>
  );
};

export default CustomerEdit;
