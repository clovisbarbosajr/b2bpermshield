import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, SlidersHorizontal, ArrowLeft } from "lucide-react";

type OptionValue = {
  id: string;
  option_id: string;
  valor: string;
  codigo: string;
  imagem_url: string;
  cor: string;
  ativo: boolean;
  padrao: boolean;
  ordem: number;
};

const AdminOptions = () => {
  const [options, setOptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit mode
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ nome: "", codigo: "", tipo: "select", max_items: 0, obrigatorio: false, ativo: true });
  const [values, setValues] = useState<OptionValue[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    const { data, error } = await supabase.from("product_options").select("*").order("nome");
    setLoading(false);
    // Sem isto, falha de leitura virava "No options yet" e o admin recriava grupos
    // que ja existem.
    if (error) { toast.error("Could not load options: " + error.message); return; }
    setOptions(data ?? []);
  };

  useEffect(() => { fetchData(); }, []);

  const openNew = () => {
    setEditing("new");
    setForm({ nome: "", codigo: "", tipo: "select", max_items: 0, obrigatorio: false, ativo: true });
    setValues([]);
  };

  const openEdit = async (o: any) => {
    // Le PRIMEIRO. Antes a tela trocava antes do await: com a leitura falhando
    // (erro nunca olhado) o editor mostrava "No values yet" para uma opcao que TEM
    // valores, e o admin recadastrava Small/Medium/Large por cima dos existentes.
    const { data, error } = await supabase.from("option_values").select("*").eq("option_id", o.id).order("ordem");
    if (error) { toast.error("Could not load this option's values: " + error.message); return; }
    setValues((data ?? []) as OptionValue[]);
    setForm({
      nome: o.nome,
      codigo: o.codigo || "",
      tipo: o.tipo,
      max_items: o.max_items || 0,
      obrigatorio: o.obrigatorio,
      ativo: o.ativo,
    });
    setEditing(o);
  };

  const handleSave = async () => {
    if (!form.nome.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    const isNew = editing === "new";
    let optionId: string;

    if (isNew) {
      const { data, error } = await supabase.from("product_options").insert(form as any).select().single();
      if (error) { toast.error(error.message); setSaving(false); return; }
      optionId = data.id;
      // A opcao JA existe no banco. Sem isto, um erro na gravacao dos valores
      // devolvia o usuario para uma tela que ainda se dizia "new": o Save seguinte
      // criava uma SEGUNDA opcao.
      setEditing(data);
    } else {
      const { error } = await supabase.from("product_options").update(form as any).eq("id", editing.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      optionId = editing.id;
    }

    // Save values — sao N escritas em sequencia, e nenhuma tinha o erro lido: o
    // valor digitado sumia e a tela dizia "Option updated" do mesmo jeito. Parar na
    // primeira falha e dizer ate onde foi e o unico relato honesto.
    // Chave = a PROPRIA LINHA (referencia do objeto), nunca a posicao: os inputs
    // nao ficam desabilitados durante o save, entao o admin pode apagar ou mexer
    // numa linha do meio enquanto grava. Por indice, o id novo acabaria colado
    // numa linha que ja tem id — duas linhas com o mesmo id, pior que o bug
    // original. Por referencia, no maximo o id se perde (a linha sumiu).
    const idsNovos = new Map<any, string>();
    const aplicaIdsNovos = () => {
      if (idsNovos.size === 0) return;
      setValues((prev: any[]) => prev.map((x) => (idsNovos.has(x) ? { ...x, id: idsNovos.get(x) } : x)));
    };

    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const payload = {
        option_id: optionId,
        valor: v.valor,
        codigo: v.codigo || "",
        imagem_url: v.imagem_url || "",
        cor: v.cor || "",
        ativo: v.ativo,
        padrao: v.padrao,
        ordem: i,
      };
      // O ID DO QUE FOI INSERIDO VOLTA PARA O ESTADO, e nao e detalhe.
      //
      // O laco para na primeira falha (certo) e a mensagem diz quantos passaram.
      // Mas o Save de novo — que e o que a mensagem manda fazer — reprocessava a
      // lista INTEIRA, e os valores ja gravados ainda estavam com `temp-`: cada
      // tentativa inseria de novo os que tinham dado certo. Duas falhas seguidas
      // deixavam o "Small" tres vezes na opcao.
      //
      // Guardando o id devolvido, a segunda passada faz UPDATE neles.
      const existente = v.id && !v.id.startsWith("temp-");
      const { data: gravado, error } = existente
        ? await supabase.from("option_values").update(payload as any).eq("id", v.id).eq("option_id", optionId).select("id").maybeSingle()
        : await supabase.from("option_values").insert(payload as any).select("id").single();
      if (!existente && gravado?.id) idsNovos.set(v, (gravado as any).id as string);
      // O `.maybeSingle()` do UPDATE ja estava aqui, mas o resultado so era lido
      // no ramo do INSERT. UPDATE que casa ZERO linhas devolve `data: null,
      // error: null` e o laco seguia: outro admin apagou o valor enquanto este
      // editor estava aberto, o update nao pegou nada, e a tela dizia "Option
      // updated" com o que ele digitou perdido.
      if (existente && !error && !gravado) {
        aplicaIdsNovos();
        toast.error(`Value "${v.valor || i + 1}" no longer exists — it was removed elsewhere. Reload the option; the first ${i} value(s) were saved.`);
        setSaving(false);
        return;
      }
      if (error) {
        // Aplica os ids ANTES de sair: sao gravacoes que ACONTECERAM, e perde-las
        // aqui e o que criava a duplicata no retry.
        aplicaIdsNovos();
        toast.error(`Value "${v.valor || i + 1}" was not saved (the first ${i} were): ${error.message}`);
        setSaving(false);
        return;
      }
    }
    aplicaIdsNovos();

    toast.success(isNew ? "Option created" : "Option updated");
    setSaving(false);
    setEditing(null);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    // CONTA A CASCATA ANTES DE PERGUNTAR. "Delete this option and all its values?"
    // nao dizia o principal: `produto_opcoes.option_id ON DELETE CASCADE`
    // (20260318202244:100) DESATRIBUI a opcao de todo produto que a usa, e nao ha
    // como saber depois quais eram. Molde de `PrivacyGroups.handleDelete`.
    //
    // Falha ao contar RECUSA o delete — nao da para avisar sobre o que nao se leu.
    const { count, error: cErr } = await supabase
      .from("produto_opcoes").select("id", { count: "exact", head: true }).eq("option_id", id);
    if (cErr) {
      toast.error("Could not check which products use this option — nothing was deleted. Try again.");
      return;
    }
    const NL = String.fromCharCode(10);
    const aviso = count
      ? ["Delete this option and all its values?", "",
         `• ${count} product(s) will lose this option — the assignment cannot be recovered.`,
         "", "This cannot be undone."].join(NL)
      : "Delete this option and all its values?";
    if (!confirm(aviso)) return;
    // Se os valores nao sairem e a opcao sair, sobram orfaos apontando para uma
    // opcao que nao existe mais — e a tela dizia "Option removed" assim mesmo.
    const { error: valErr } = await supabase.from("option_values").delete().eq("option_id", id);
    if (valErr) { toast.error("Could not remove the option's values: " + valErr.message); return; }
    const { error } = await supabase.from("product_options").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Option removed");
    fetchData();
  };

  const addValueRow = () => {
    setValues([...values, {
      id: `temp-${Date.now()}`,
      option_id: editing === "new" ? "" : editing.id,
      valor: "",
      codigo: "",
      imagem_url: "",
      cor: "",
      ativo: true,
      padrao: false,
      ordem: values.length,
    }]);
  };

  const updateValue = (idx: number, field: string, val: any) => {
    const updated = [...values];
    (updated[idx] as any)[field] = val;
    setValues(updated);
  };

  const removeValue = async (idx: number) => {
    const v = values[idx];
    if (v.id && !v.id.startsWith("temp-")) {
      const { error } = await supabase.from("option_values").delete().eq("id", v.id);
      if (error) {
        // Sem isto, a linha sumia da TELA e continuava no banco: o usuario
        // fechava a pagina achando que tinha removido, e o valor reaparecia.
        toast.error("Could not remove: " + error.message);
        return;
      }
    }
    // FORMA FUNCIONAL: o `values` desta closure e o do render ANTERIOR ao await
    // do delete. Os inputs nao ficam desabilitados durante a ida ao servidor (o
    // proprio `handleSave` deste arquivo registra isso), entao digitar noutra
    // linha enquanto o delete roda fazia o array velho voltar por cima — e o
    // valor antigo era regravado no Save seguinte, sem aviso.
    setValues((prev: any[]) => prev.filter((_, i) => i !== idx));
    toast.success("Value removed");
  };

  // ---- EDIT VIEW ----
  if (editing) {
    return (
      <AdminLayout>
        <div className="mb-4">
          <Button variant="ghost" onClick={() => setEditing(null)} className="gap-1 mb-2">
            <ArrowLeft className="h-4 w-4" /> Back to options
          </Button>
          <h2 className="font-display text-2xl font-semibold">
            {editing === "new" ? "New product option" : "Editing product option"}
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <Label>Name</Label>
            <Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="e.g. Size" />
            <p className="text-xs text-muted-foreground mt-1">Name is shown to your clients.</p>
          </div>
          <div>
            <Label>Code</Label>
            <Input value={form.codigo} onChange={e => setForm({ ...form, codigo: e.target.value })} placeholder="e.g. SZ" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <Label>Type</Label>
            <Select value={form.tipo} onValueChange={v => setForm({ ...form, tipo: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="select">List of Values</SelectItem>
                <SelectItem value="radio">Radio Buttons</SelectItem>
                <SelectItem value="checkbox">Checkboxes</SelectItem>
                <SelectItem value="text">Text Input</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Max Items</Label>
            <Input type="number" value={form.max_items} onChange={e => setForm({ ...form, max_items: Number(e.target.value) })} />
          </div>
        </div>
        <div className="flex items-center gap-2 mb-6">
          <Checkbox checked={form.obrigatorio} onCheckedChange={v => setForm({ ...form, obrigatorio: !!v })} id="required" />
          <Label htmlFor="required">Is required</Label>
        </div>

        {/* Values Table */}
        <h3 className="text-lg font-semibold mb-3">List of Values</h3>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Image</TableHead>
                <TableHead>Color</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {values.map((v, i) => (
                <TableRow key={v.id}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <Input value={v.valor} onChange={e => updateValue(i, "valor", e.target.value)} className="h-8" />
                  </TableCell>
                  <TableCell>
                    <Input value={v.codigo} onChange={e => updateValue(i, "codigo", e.target.value)} className="h-8" />
                  </TableCell>
                  <TableCell>
                    <Input type="file" accept="image/*" className="h-8 text-xs" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const path = `option-values/${Date.now()}-${file.name}`;
                      const { error } = await supabase.storage.from("product-images").upload(path, file);
                      if (error) { toast.error(error.message); return; }
                      const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
                      updateValue(i, "imagem_url", urlData.publicUrl);
                      toast.success("Image uploaded");
                    }} />
                    {v.imagem_url && <img src={v.imagem_url} alt="" className="h-6 w-6 mt-1 rounded object-cover" />}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={v.cor || "#000000"}
                        onChange={e => updateValue(i, "cor", e.target.value)}
                        className="h-8 w-8 rounded border cursor-pointer"
                      />
                      <div className="flex flex-col gap-1 text-xs">
                        <label className="flex items-center gap-1">
                          <input type="checkbox" checked={v.ativo} onChange={e => updateValue(i, "ativo", e.target.checked)} /> Active
                        </label>
                        <label className="flex items-center gap-1">
                          <input type="checkbox" checked={v.padrao} onChange={e => updateValue(i, "padrao", e.target.checked)} /> Default
                        </label>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeValue(i)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {values.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No values yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>

        <div className="mt-4 flex gap-2">
          <Button onClick={addValueRow} variant="outline" className="gap-1 bg-primary text-primary-foreground">
            <Plus className="h-4 w-4" /> Add new value
          </Button>
        </div>

        <div className="mt-6 flex gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
        </div>
      </AdminLayout>
    );
  }

  // ---- LIST VIEW ----
  return (
    <AdminLayout>
      <div className="mb-4">
        <h2 className="font-display text-2xl font-semibold">Product options</h2>
      </div>

      <Button onClick={openNew} className="gap-1 mb-4 bg-primary text-primary-foreground">
        <Plus className="h-4 w-4" /> Add product option group
      </Button>

      {loading ? (
        <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : options.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <SlidersHorizontal className="h-12 w-12 text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold">No options yet</h3>
          <p className="text-muted-foreground mb-4">Create product options like Size, Color, Material.</p>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Create Option</Button>
        </Card>
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Sort</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {options.map((o, idx) => (
                  <TableRow key={o.id}>
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="font-medium">{o.nome}</TableCell>
                    <TableCell>{o.codigo || ""}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="default" size="icon" className="h-7 w-7 bg-cyan-600 hover:bg-cyan-700" onClick={() => openEdit(o)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="default" size="icon" className="h-7 w-7 bg-destructive hover:bg-destructive/90" onClick={() => handleDelete(o.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Button onClick={openNew} className="gap-1 mt-4 bg-primary text-primary-foreground">
            <Plus className="h-4 w-4" /> Add product option group
          </Button>
        </>
      )}
    </AdminLayout>
  );
};

export default AdminOptions;
