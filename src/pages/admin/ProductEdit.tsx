import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowLeft, Save, Upload, Plus, Trash2, Image as ImageIcon, FileText, Loader2, Lock, X } from "lucide-react";
import { useActivityLog } from "@/hooks/useActivityLog";
import { categoryTreeOptions } from "@/lib/categoryTree";
import { fetchAllRows } from "@/lib/fetchAllRows";

// O PostgREST corta em 1000 linhas SEM erro. Este wrapper pagina e devolve o
// mesmo formato `{ data, error }` das outras leituras, para caber no `Promise.all`
// e na trava de carregamento — inclusive o erro, que e o que a trava le.
//
// `.range(f, t)` exige ORDEM ESTAVEL, senao a pagina 2 repete ou pula linha. Por
// isso quem chama ordena por `id`, e quem precisa de ordem alfabetica reordena em
// memoria depois.
const tudo = <T,>(
  q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
) => fetchAllRows<T>(q).then(
  (data) => ({ data, error: null as any }),
  (error) => ({ data: null as T[] | null, error }),
);

const porNome = <T extends { nome?: string | null }>(rows: T[]) =>
  [...rows].sort((a, b) => (a.nome ?? "").localeCompare(b.nome ?? ""));

type Categoria = { id: string; nome: string; parent_id: string | null; ordem?: number | null };
type Brand = { id: string; nome: string };
type TabelaPreco = { id: string; nome: string };
type Cliente = { id: string; nome: string; empresa: string };
type ProductOption = { id: string; nome: string; tipo: string };

const statusOptions = [
  { value: "disponivel", label: "Available" },
  { value: "estoque_limitado", label: "Limited Stock" },
  { value: "esgotado", label: "Sold Out" },
  { value: "descontinuado", label: "Discontinued" },
  { value: "indisponivel", label: "Not Available" },
  { value: "pre_venda", label: "Pre-order" },
];

const ofertasOptions = [
  { value: "nunca", label: "Never" },
  { value: "sempre", label: "Always" },
  { value: "com_desconto", label: "Only if discounts are available" },
];

const ProductEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === "new";
  const { log } = useActivityLog();

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  // Id do produto que ESTE save criou. Ver o comentario no `handleSave`: existe
  // para a segunda tentativa nao criar um segundo produto.
  const criadoIdRef = useRef<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState("product");
  const [meta, setMeta] = useState<{ created_at?: string; updated_at?: string }>({});

  // Lookup data
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [tabelasPreco, setTabelasPreco] = useState<TabelaPreco[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [privacyGroups, setPrivacyGroups] = useState<{ id: string; nome: string }[]>([]);

  // Main product form
  const [form, setForm] = useState({
    nome: "", sku: "", descricao: "", imagem_url: "", categoria_id: "", brand_id: "",
    preco: 0, custo: 0, preco_msrp: 0, peso: 0, comprimento: 0, largura: 0, altura: 0,
    quantidade_minima: 1, quantidade_maxima: 0, estoque_total: 0, estoque_reservado: 0,
    rastrear_estoque: true, permitir_backorder: false, quantidade_caixa: 0,
    status_produto: "disponivel", data_disponibilidade: "", unidade_venda: "un",
    ativo: true, barcode: "", codigo_upc: "", codigo_referencia: "",
    quantidade_pacote: 0, meta_descricao: "", descricao_pdf: "", tag_line: "",
    promover_categoria: false, promover_destaque: false, mostrar_ofertas: "nunca",
    is_private: false,
  });

  // Sub-tab data
  const [galleryImages, setGalleryImages] = useState<{ id?: string; imagem_url: string; ordem: number }[]>([]);
  const [files, setFiles] = useState<{ id?: string; titulo: string; arquivo_url: string }[]>([]);
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [customerPrices, setCustomerPrices] = useState<any[]>([]);
  const [relatedProducts, setRelatedProducts] = useState<any[]>([]);
  // Busca de produtos p/ vincular relacionados (por NOME, não por ID cru).
  const [allProducts, setAllProducts] = useState<{ id: string; nome: string; sku: string | null }[]>([]);
  const [relOpenIdx, setRelOpenIdx] = useState<number | null>(null);
  const [relQuery, setRelQuery] = useState("");
  const [assignedOptions, setAssignedOptions] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const [statusRules, setStatusRules] = useState<any[]>([]);
  // Acesso/privacidade (modelo B2BWave): grupos com acesso + grant/exclude por cliente.
  const [accGroups, setAccGroups] = useState<Set<string>>(new Set());
  const [accGrant, setAccGrant] = useState<string[]>([]);
  const [accExclude, setAccExclude] = useState<string[]>([]);
  const [priceLists, setPriceLists] = useState<{ tabela_preco_id: string; preco: number }[]>([]);
  // Snapshot do que veio do BANCO. Sem ele nao da para saber quais precos a
  // pessoa realmente editou — e sem isso nao ha carimbo de procedencia correto:
  // marcar `local` em tudo que a tela grava mataria a auto-cura da coluna
  // `origem`, porque esta tela reescreve TODAS as linhas do produto a cada save.
  const [origPriceLists, setOrigPriceLists] = useState<Record<string, number>>({});
  // `false` quando alguma leitura de sub-dado falhou no carregamento. Bloqueia o
  // save, porque o save apaga e reescreve essas tabelas a partir do estado da
  // tela — e o estado esta incompleto.
  // Nomes das leituras de sub-dado que FALHARAM no carregamento. Lista, e nao
  // booleano, porque o banner precisa dizer QUAL tabela nao veio — "parte dos
  // dados falhou" nao ajuda ninguem a decidir o que fazer.
  const [falhouCarregar, setFalhouCarregar] = useState<string[]>([]);

  useEffect(() => {
    fetchLookups();
    if (!isNew) fetchProduct();
  }, [id]);

  const fetchLookups = async () => {
    const [c, b, tp, cl, po, pg, allp] = await Promise.all([
      supabase.from("categorias").select("id, nome, parent_id, ordem").eq("ativo", true).order("nome"),
      supabase.from("brands").select("id, nome").order("nome"),
      supabase.from("tabelas_preco").select("id, nome").order("nome"),
      // DUAS LISTAS PASSAM DE 1000 LINHAS E VINHAM CORTADAS.
      //
      // `clientes` e `produtos` crescem com o cadastro; as outras cinco sao
      // limitadas por configuracao (categorias, marcas, tabelas de preco, opcoes,
      // grupos de privacidade). Cortadas, o estrago e de tela, nao de dado: o chip
      // de acesso do cliente 1001 aparecia como UUID cru em vez do nome da empresa
      // (o `|| cid` do badge), e nem ele nem o produto 1001 apareciam nos seletores
      // — nao havia como conceder acesso nem relacionar produto a partir dali.
      //
      // A ordem alfabetica que a UI usa vem do `porNome` em memoria: paginar exige
      // ordenar por `id`, e as duas coisas nao cabem na mesma query.
      //
      // MEDIDO EM 27/ago/2026, contra o banco: 70 clientes e 278 produtos ativos.
      // Nenhuma das duas estoura HOJE — isto e seguro para o crescimento, nao
      // conserto de defeito ativo. Eu tinha escrito que `produtos` ja passava de
      // 1000; era chute, e o numero desmentiu. As que realmente estouram sao
      // `pedidos` (2784) e `tabela_preco_itens` (1015), e nenhuma das duas e lida
      // aqui sem filtro de produto.
      tudo<any>((f, t) => supabase.from("clientes").select("id, nome, empresa").order("id", { ascending: true }).range(f, t) as any),
      supabase.from("product_options").select("id, nome, tipo").order("nome"),
      supabase.from("privacy_groups").select("id, nome").eq("ativo", true).order("nome"),
      tudo<any>((f, t) => supabase.from("produtos").select("id, nome, sku").eq("ativo", true).order("id", { ascending: true }).range(f, t) as any),
    ]);
    setCategorias(c.data ?? []);
    setBrands(b.data ?? []);
    setTabelasPreco(tp.data ?? []);
    setClientes(porNome(cl.data ?? []));
    setProductOptions(po.data ?? []);
    setPrivacyGroups(pg.data ?? []);
    setAllProducts(porNome((allp.data as any[]) ?? []));
  };

  const prodName = (pid: string) => {
    const p = allProducts.find((x) => x.id === pid);
    return p ? `${p.nome}${p.sku ? ` (${p.sku})` : ""}` : "";
  };

  const fetchProduct = async () => {
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

    const { data, error } = await supabase.from("produtos").select("*").eq("id", id).single();
    if (error || !data) { toast.error("Product not found"); navigate("/admin/products"); return; }

    setForm({
      nome: data.nome, sku: data.sku, descricao: data.descricao ?? "", imagem_url: data.imagem_url ?? "",
      categoria_id: data.categoria_id ?? "", brand_id: data.brand_id ?? "",
      preco: Number(data.preco), custo: Number((data as any).custo ?? 0), preco_msrp: Number((data as any).preco_msrp ?? 0),
      peso: Number((data as any).peso ?? 0), comprimento: Number((data as any).comprimento ?? 0),
      largura: Number((data as any).largura ?? 0), altura: Number((data as any).altura ?? 0),
      quantidade_minima: data.quantidade_minima, quantidade_maxima: (data as any).quantidade_maxima ?? 0,
      estoque_total: data.estoque_total, estoque_reservado: data.estoque_reservado,
      rastrear_estoque: (data as any).rastrear_estoque ?? true, permitir_backorder: (data as any).permitir_backorder ?? false,
      quantidade_caixa: (data as any).quantidade_caixa ?? 0, status_produto: (data as any).status_produto ?? "disponivel",
      data_disponibilidade: (data as any).data_disponibilidade ?? "", unidade_venda: data.unidade_venda,
      ativo: data.ativo, barcode: (data as any).barcode ?? "", codigo_upc: (data as any).codigo_upc ?? "",
      codigo_referencia: (data as any).codigo_referencia ?? "", quantidade_pacote: (data as any).quantidade_pacote ?? 0,
      meta_descricao: (data as any).meta_descricao ?? "", descricao_pdf: (data as any).descricao_pdf ?? "",
      tag_line: (data as any).tag_line ?? "",
      promover_categoria: (data as any).promover_categoria ?? false,
      promover_destaque: (data as any).promover_destaque ?? false,
      mostrar_ofertas: (data as any).mostrar_ofertas ?? "nunca",
      is_private: (data as any).is_private ?? false,
    });

    setMeta({ created_at: (data as any).created_at, updated_at: (data as any).updated_at });

    // TRES DESTAS LEITURAS ESCALAM COM O NUMERO DE CLIENTES, E O PostgREST CORTA
    // EM 1000 LINHAS SEM ERRO NENHUM.
    //
    // A trava de carregamento nao pega isso: `error` vem null, a lista chega
    // incompleta e o save — que apaga e reescreve a partir da tela — descarta a
    // linha 1001 em diante. O cliente perde o preco especial ou o acesso ao
    // produto privado, e nada na tela indica que faltou algo.
    //
    // As outras nove sao por produto e limitadas pelo conteudo (imagens,
    // arquivos, variantes, tabelas de preco). So estas tres crescem com o
    // cadastro de clientes:
    //   * `produto_precos_cliente` — uma linha por cliente com preco especial;
    //   * `produto_cliente_acesso` — um grant/exclude por cliente;
    //   * `privacy_groups` — leitura sem filtro de produto, a unica ilimitada.
    //
    // O `tudo` esta no topo do arquivo: o `fetchLookups` usa o mesmo helper.

    // Fetch sub-data in parallel
    const [imgs, fls, disc, cp, rel, opts, vars, sr, acc, pl, cliAcc, pgRes] = await Promise.all([
      supabase.from("produto_imagens").select("*").eq("produto_id", id).order("ordem"),
      supabase.from("produto_arquivos").select("*").eq("produto_id", id),
      supabase.from("produto_descontos").select("*").eq("produto_id", id),
      tudo<any>((f, t) => supabase.from("produto_precos_cliente").select("*").eq("produto_id", id).order("id", { ascending: true }).range(f, t) as any),
      supabase.from("produtos_relacionados").select("*").eq("produto_id", id),
      supabase.from("produto_opcoes").select("*").eq("produto_id", id),
      supabase.from("produto_variantes").select("*").eq("produto_id", id),
      supabase.from("produto_status_regras").select("*").eq("produto_id", id),
      supabase.from("produto_acesso").select("*").eq("produto_id", id),
      supabase.from("tabela_preco_itens").select("*").eq("produto_id", id),
      tudo<any>((f, t) => (supabase as any).from("produto_cliente_acesso").select("cliente_id, tipo").eq("produto_id", id).order("id", { ascending: true }).range(f, t)),
      tudo<any>((f, t) => supabase.from("privacy_groups").select("id, nome").order("id", { ascending: true }).range(f, t) as any),
    ]);
    // SE ALGUMA LEITURA FALHOU, A TELA RECUSA SALVAR.
    //
    // NOVE destas tabelas o save apaga e reescreve a partir do estado da tela.
    // Uma leitura que falha cai em ?? [], o estado fica VAZIO, e o save apaga os
    // dados de verdade — com "Product saved" na tela. Perda total e silenciosa, e
    // o dono nao tem como saber que perdeu.
    //
    // As outras tres entram na trava por motivo PROPRIO — dizer que as doze
    // funcionam igual seria falso:
    //   * produto_variantes apaga o que SUMIU da tela; com o estado vazio isso e
    //     TODAS, e leva o vinculo dos pedidos junto;
    //   * tabela_preco_itens faz diff por snapshot, entao vazio nao apaga nada —
    //     mas mostraria "sem preco" para um produto que TEM preco;
    //   * privacy_groups nunca e escrita; ela resolve o nome do grupo em
    //     produto_acesso, e ESSA e apagada e reescrita.
    //
    // RESSALVA: negacao de RLS num SELECT devolve [] com HTTP 200 e SEM `error`.
    // Esta guarda cobre rede, timeout e 5xx — nao cobre RLS.
    //
    // Uma trava para as doze, e nao doze tratamentos: a falha e rara, e recusar
    // salvar e a resposta certa para todas. Tratar cada tabela separadamente
    // seria mais codigo para o mesmo resultado.
    const falhas = [
      ["images", imgs.error], ["files", fls.error], ["discounts", disc.error],
      ["customer prices", cp.error], ["related products", rel.error],
      ["options", opts.error], ["variants", vars.error], ["status rules", sr.error],
      ["access", acc.error], ["price lists", pl.error],
      ["customer access", (cliAcc as any).error], ["privacy groups", pgRes.error],
    ].filter(([, e]) => e) as [string, { message: string }][];
    setFalhouCarregar(falhas.map(([n]) => n));
    if (falhas.length > 0) {
      toast.error(`Could not load: ${falhas.map(([n]) => n).join(", ")}. Saving is blocked — reload the page.`);
    }

    setGalleryImages(imgs.data ?? []);
    setFiles(fls.data ?? []);
    setDiscounts(disc.data ?? []);
    setCustomerPrices(cp.data ?? []);
    setRelatedProducts(rel.data ?? []);
    setAssignedOptions(opts.data ?? []);
    setVariants(vars.data ?? []);
    setStatusRules(sr.data ?? []);
    // produto_acesso pode ter privacy_group_id (uuid) OU grupo_nome (nome ou, em
    // dados antigos, um uuid) — resolvemos para o id do grupo dos dois jeitos.
    const groupIds = new Set<string>();
    for (const r of ((acc.data ?? []) as any[])) {
      const gid = r.privacy_group_id
        || (pgRes.data ?? []).find((p: any) => p.id === r.grupo_nome)?.id
        || (pgRes.data ?? []).find((p: any) => p.nome === r.grupo_nome)?.id;
      if (gid) groupIds.add(gid);
    }
    setAccGroups(groupIds);
    setAccGrant(((cliAcc.data ?? []) as any[]).filter((r) => r.tipo === "grant").map((r) => r.cliente_id));
    setAccExclude(((cliAcc.data ?? []) as any[]).filter((r) => r.tipo === "exclude").map((r) => r.cliente_id));
    const precosDoBanco = (pl.data ?? []).map((p: any) => ({ tabela_preco_id: p.tabela_preco_id, preco: Number(p.preco) }));
    setPriceLists(precosDoBanco);
    setOrigPriceLists(Object.fromEntries(precosDoBanco.map((p) => [p.tabela_preco_id, p.preco])));

    setLoading(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, target: "main" | "gallery") => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file);
    if (error) { toast.error("Upload error: " + error.message); setUploading(false); return; }
    const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
    if (target === "main") {
      setForm({ ...form, imagem_url: urlData.publicUrl });
    } else {
      setGalleryImages([...galleryImages, { imagem_url: urlData.publicUrl, ordem: galleryImages.length }]);
    }
    setUploading(false);
    toast.success("Image uploaded");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `files/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file);
    if (error) { toast.error("Upload error: " + error.message); setUploading(false); return; }
    const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
    setFiles([...files, { titulo: file.name, arquivo_url: urlData.publicUrl }]);
    setUploading(false);
    toast.success("File uploaded");
  };

  // ── VALIDACAO DE FORMULARIO, SEM TOCAR NO SERVIDOR ──────────────────────────
  // Isto vivia dentro do `saveSubData`, ou seja: rodava DEPOIS do INSERT em
  // `produtos`. Continua sendo a mesma checagem, so que agora antes de gravar.
  //
  // O padrao do `saveSubData` e DELETE + INSERT sem transacao: se o INSERT falha,
  // os dados JA foram apagados. O `orFail` avisa e o formulario segue em memoria,
  // mas um F5 consolida a perda. A falha MAIS provavel e previsivel: os botoes
  // "Add" criam a linha com o campo-chave vazio (`tabela_preco_id: ""`,
  // `cliente_id: ""`, `status_nome: ""`) e "" nao e uuid valido nem passa no NOT
  // NULL. Basta clicar Add e salvar sem escolher.
  const problemasDeFormulario = (): string[] => {
    const faltando: string[] = [];
    if (discounts.some((d: any) => !String(d.tabela_preco_id ?? "").trim()))
      faltando.push('Discounts: pick a price list on every row');
    if (customerPrices.some((cp: any) => !String(cp.cliente_id ?? "").trim()))
      faltando.push('Customer prices: pick a customer on every row');
    // Repetida quebra de dois jeitos: `21000 cardinality_violation` no upsert
    // (DEPOIS de o DELETE ja ter sido commitado), ou — pior, silencioso — trocar a
    // linha A para a tabela B que ja esta na tela com o mesmo preco: nenhuma das
    // duas fica "suja", nada e gravado, e o preco de A e apagado sem erro nenhum.
    {
      const ids = priceLists.map((pl: any) => String(pl.tabela_preco_id ?? "").trim()).filter(Boolean);
      if (new Set(ids).size !== ids.length) faltando.push("Price lists: the same price list is used twice");
    }
    if (priceLists.some((pl: any) => !String(pl.tabela_preco_id ?? "").trim()))
      faltando.push('Price lists: pick a price list on every row');
    if (statusRules.some((sr: any) => !String(sr.status_nome ?? "").trim()))
      faltando.push('Status rules: pick a status on every row');
    if (assignedOptions.some((o: any) => !String(o.option_id ?? "").trim()))
      faltando.push('Options: pick an option on every row');
    if (galleryImages.some((g: any) => !String(g.imagem_url ?? "").trim()))
      faltando.push('Gallery: an image row has no file');
    if (files.some((f: any) => !String(f.arquivo_url ?? "").trim()))
      faltando.push('Files: a file row has no file');
    return faltando;
  };

  const handleSave = async (goBack = false) => {
    // Code (sku) é OPCIONAL — igual ao B2BWave original. Vazio vira NULL no banco
    // (string vazia colidiria na UNIQUE a partir do 2º produto sem código).
    if (!form.nome) { toast.error("Name is required"); return; }
    // VARIANTE COM O CODE APAGADO NAO E EXCLUSAO.
    //
    // O save trata variante sem `codigo` como "sumiu da tela" e a DELETA — junto
    // com os precos dela (cascata) e o vinculo dos pedidos que a usaram. A linha
    // continua visivel na tela e o toast diz "Product saved". Alcancavel sem
    // acidente: variante sincronizada com codigo so-de-espacos ja nasce vazia,
    // e basta abrir o produto e salvar.
    //
    // `v.id &&`: linha NOVA sem codigo continua sendo ignorada em silencio, que e
    // o comportamento documentado do bloco de variantes. So a que JA EXISTE no
    // banco vira erro — porque so nela apagar destroi alguma coisa.
    const semCodigo = variants
      .map((v: any, i: number) => ({ v, linha: i + 1 }))
      .filter(({ v }) => v.id && !(v.codigo ?? "").trim())
      .map(({ linha }) => linha);
    if (semCodigo.length > 0) {
      toast.error(`Variants: row ${semCodigo.join(", ")} has no Code. Type the Code back, or use the trash button to delete the variant.`);
      return;
    }
    // BLOQUEIO. O save apaga e reescreve as tabelas de sub-dado a partir do
    // estado da tela; com o estado incompleto, ele apagaria o que nao carregou.
    // Recarregar e a saida — nao ha como salvar "so a parte que carregou" sem
    // saber qual parte e.
    if (falhouCarregar.length > 0) {
      toast.error(`Nothing was saved: ${falhouCarregar.join(", ")} failed to load. Reload the page and try again.`);
      return;
    }
    // TODA VALIDACAO DE FORMULARIO ACONTECE AQUI, ANTES DE GRAVAR QUALQUER COISA.
    //
    // As duas checagens abaixo rodavam DEPOIS do INSERT em `produtos`. Num produto
    // novo isso significava: linha criada e ATIVA no catalogo, sub-dado nenhum, e a
    // tela dizendo "Nothing was saved" — mentira. E cada nova tentativa criava mais
    // um produto ativo, sem teto: um erro de digitacao no estoque de uma variante
    // rendia cinco produtos-fantasma no catalogo do cliente.
    //
    // Nenhuma das duas toca o servidor — sao leituras do estado da tela. Nao havia
    // motivo para rodarem depois.
    const variantesRuins = variants
      .filter((v: any) => (v.codigo ?? "").trim())
      .filter((v: any) => {
        const n = Number(String(v.quantidade ?? "").trim());
        return !Number.isFinite(n) || n < 0;
      })
      .map((v: any) => String(v.codigo).trim());
    if (variantesRuins.length > 0) {
      toast.error(`Invalid stock quantity on: ${variantesRuins.join(", ")}. Use a whole number of 0 or more.`);
      return;
    }
    const faltando = problemasDeFormulario();
    if (faltando.length > 0) {
      toast.error(`Nothing was saved — fix these first:\n• ${faltando.join('\n• ')}`);
      return;
    }

    setSaving(true);

    const payload: any = {
      nome: form.nome, sku: (form.sku as string)?.trim() || null, descricao: form.descricao || null, imagem_url: form.imagem_url || null,
      categoria_id: form.categoria_id || null, brand_id: form.brand_id || null,
      preco: form.preco, custo: form.custo, preco_msrp: form.preco_msrp,
      peso: form.peso, comprimento: form.comprimento, largura: form.largura, altura: form.altura,
      quantidade_minima: form.quantidade_minima, quantidade_maxima: form.quantidade_maxima,
      estoque_total: form.estoque_total, rastrear_estoque: form.rastrear_estoque,
      permitir_backorder: form.permitir_backorder, quantidade_caixa: form.quantidade_caixa,
      status_produto: form.status_produto, data_disponibilidade: form.data_disponibilidade || null,
      unidade_venda: form.unidade_venda, ativo: form.ativo,
      barcode: form.barcode || null, codigo_upc: form.codigo_upc || null,
      codigo_referencia: form.codigo_referencia || null, quantidade_pacote: form.quantidade_pacote || null,
      meta_descricao: form.meta_descricao || null, descricao_pdf: form.descricao_pdf || null,
      tag_line: form.tag_line || null,
      promover_categoria: form.promover_categoria, promover_destaque: form.promover_destaque,
      mostrar_ofertas: form.mostrar_ofertas,
      is_private: form.is_private,
    };

    // `criadoIdRef`: SEGUNDA tentativa nao cria SEGUNDO produto.
    //
    // A validacao acima cobre o que da para checar na tela. O que sobra falha no
    // servidor — RLS, rede, constraint — e a falha vem DEPOIS do INSERT, ja com o
    // produto criado. Sem esta memoria, o Save de novo (que e exatamente o que a
    // mensagem manda fazer) inseria outro. Guardando o id, a repeticao vira UPDATE
    // do mesmo produto.
    //
    // `useRef` e nao `useState` de proposito: o valor precisa valer JA na proxima
    // linha deste mesmo handler, e `setState` so aparece no render seguinte.
    // Ele mora na instancia da tela — a `key` da rota derruba a instancia junto com
    // o ref quando o admin sai para criar outro produto, que e o comportamento certo.
    // `isNew ? null : id` e nao `id` puro: `isNew` tambem e verdadeiro quando `id`
    // vale a string "new". Testar so a verdade de `id` mandaria esse caso para o
    // UPDATE com `.eq("id", "new")` — uuid invalido. Mantem a decisao de ramo
    // exatamente onde ela ja estava.
    let productId = criadoIdRef.current ?? (isNew ? null : id);

    if (!productId) {
      const { data, error } = await supabase.from("produtos").insert(payload).select("id").single();
      if (error) { toast.error(error.message); setSaving(false); return; }
      productId = data.id;
      criadoIdRef.current = data.id;
    } else {
      const { error } = await supabase.from("produtos").update(payload).eq("id", productId);
      if (error) { toast.error(error.message); setSaving(false); return; }
    }

    // Save sub-data — se um insert de privacidade/preço falhar, avisa e NÃO declara
    // sucesso (o estado segue em memória, é só reenviar).
    try {
      await saveSubData(productId!);
    } catch (e: any) {
      setSaving(false);
      toast.error(e?.message || "Error saving product data. Please try saving again.");
      return;
    }

    setSaving(false);
    // O snapshot de precos NAO e atualizado aqui: ele acompanha a gravacao, dentro
    // do `saveSubData`, logo depois do bloco de precos. Ver o comentario la.
    toast.success(isNew ? "Product created" : "Product saved");
    log(isNew ? "created" : "updated", "product", productId!, form.nome as string);
    if (goBack) { navigate("/admin/products"); return; }
    if (isNew) navigate(`/admin/products/${productId}`);
  };

  const saveSubData = async (pid: string) => {
    // Todo bloco aqui é DELETE + INSERT. O insert PRECISA checar erro: como o
    // delete já foi commitado, um insert que falha (RLS, constraint, rede) APAGA
    // os dados — e antes disso passava batido, com a tela dizendo "Product saved"
    // (galeria/preços/price lists sumiam em silêncio). Lançar aqui faz o
    // handleSave avisar sem declarar sucesso; o estado segue em memória.
    const orFail = ({ error }: { error: any }, what: string) => {
      if (error) throw new Error(`Failed to save ${what}: ${error.message}`);
    };

    // DELETE também é checado: um delete que falha (RLS) passava em silêncio e o
    // INSERT seguinte batia em chave duplicada (ex.: tabela_preco_itens tem
    // UNIQUE(tabela_preco_id, produto_id)), com uma mensagem que não explicava nada.
    const delOrFail = async (table: string, what: string) => {
      const { error } = await (supabase as any).from(table).delete().eq("produto_id", pid);
      if (error) throw new Error(`Failed to replace ${what}: ${error.message}`);
    };

    // Gallery images
    await delOrFail("produto_imagens", "gallery images");
    if (galleryImages.length > 0) {
      orFail(await supabase.from("produto_imagens").insert(galleryImages.map((img, i) => ({
        produto_id: pid, imagem_url: img.imagem_url, ordem: i
      }))), "gallery images");
    }

    // Files
    await delOrFail("produto_arquivos", "files");
    if (files.length > 0) {
      orFail(await supabase.from("produto_arquivos").insert(files.map(f => ({
        produto_id: pid, titulo: f.titulo, arquivo_url: f.arquivo_url
      }))), "files");
    }

    // Discounts
    await delOrFail("produto_descontos", "discounts");
    if (discounts.length > 0) {
      orFail(await supabase.from("produto_descontos").insert(discounts.map(d => ({ ...d, produto_id: pid, id: undefined }))), "discounts");
    }

    // Customer prices
    await delOrFail("produto_precos_cliente", "customer prices");
    if (customerPrices.length > 0) {
      orFail(await supabase.from("produto_precos_cliente").insert(customerPrices.map(cp => ({ ...cp, produto_id: pid, id: undefined }))), "customer prices");
    }

    // Related products — ignora linhas sem produto escolhido (FK invalida).
    await delOrFail("produtos_relacionados", "related products");
    const relValid = relatedProducts.filter(rp => rp.produto_relacionado_id);
    if (relValid.length > 0) {
      orFail(await supabase.from("produtos_relacionados").insert(relValid.map(rp => ({ ...rp, produto_id: pid, id: undefined }))), "related products");
    }

    // Assigned options
    await delOrFail("produto_opcoes", "assigned options");
    if (assignedOptions.length > 0) {
      orFail(await supabase.from("produto_opcoes").insert(assignedOptions.map(o => ({ produto_id: pid, option_id: o.option_id }))), "assigned options");
    }

    // Price lists — UPSERT do que mudou + DELETE do que saiu da tela.
    //
    // Era `delete` de tudo seguido de `insert` de tudo. Funcionava, mas destruia
    // a linha a cada save: a procedencia (`origem`, 20260826100000) voltava para
    // `desconhecido` e o `created_at` era resetado — entao nenhum dos dois servia
    // para julgar nada. Um save de produto lavava o carimbo do produto inteiro.
    //
    // SAO DUAS METADES, e a segunda nao pode faltar: hoje quem faz a LIXEIRA
    // funcionar e justamente o delete geral. Trocando so por upsert, apertar a
    // lixeira e salvar deixaria o preco vivo no banco com a tela mostrando que
    // sumiu — numa tabela de dinheiro, isso e pior que o problema original.
    {
      const idsNaTela = priceLists.map((pl) => pl.tabela_preco_id).filter(Boolean);
      const removidos = Object.keys(origPriceLists).filter((id) => !idsNaTela.includes(id));
      if (removidos.length > 0) {
        const { error } = await supabase.from("tabela_preco_itens")
          .delete().eq("produto_id", pid).in("tabela_preco_id", removidos);
        if (error) throw new Error(`Failed to remove price lists: ${error.message}`);
      }

      // So o que MUDOU. Linha intocada nao e reescrita, entao mantem a origem que
      // ja tinha — e a auto-cura do sync continua valendo para ela.
      const sujos = priceLists.filter((pl) => pl.tabela_preco_id
        && origPriceLists[pl.tabela_preco_id] !== pl.preco);
      if (sujos.length > 0) {
        orFail(await supabase.from("tabela_preco_itens").upsert(
          sujos.map((pl) => ({
            produto_id: pid, tabela_preco_id: pl.tabela_preco_id, preco: pl.preco,
            // Preco que uma PESSOA digitou nesta tela.
            origem: "local",
          })),
          { onConflict: "tabela_preco_id,produto_id" },
        ), "price lists");
      }

      // O SNAPSHOT ACOMPANHA A GRAVACAO, NAO O FIM DO SAVE.
      //
      // Esta linha ficava no fim do `handleSave`, ou seja: so rodava se TODO o
      // resto tambem desse certo. Bastava o bloco seguinte falhar (status rules,
      // acesso, o que for) para o preco JA estar gravado e o snapshot continuar
      // velho.
      //
      // A sequencia que apaga preco em silencio: o admin apaga a linha da tabela
      // X e salva; o DELETE de X passa, um bloco posterior falha. Ele corrige o
      // outro problema mas re-adiciona X com o mesmo preco antes de salvar de
      // novo. Agora `removidos` esta vazio (X esta na tela) E `sujos` esta vazio
      // (o preco bate com o snapshot velho, que ainda tem X). Nada e gravado, a
      // tela diz "Product saved" e mostra X, e o banco nao tem X — o cliente
      // daquela tabela passa a pagar o preco base.
      setOrigPriceLists(Object.fromEntries(
        priceLists.filter((p) => p.tabela_preco_id).map((p) => [p.tabela_preco_id, p.preco]),
      ));
    }

    // Status rules
    await delOrFail("produto_status_regras", "status rules");
    if (statusRules.length > 0) {
      orFail(await supabase.from("produto_status_regras").insert(
        statusRules.map(sr => ({ produto_id: pid, status_nome: sr.status_nome, regra_tipo: sr.regra_tipo, valor_limite: sr.valor_limite }))
      ), "status rules");
    }

    // Variantes (aba "Code & Price Variants"). Esta tabela era só LIDA: dava pra
    // criar/editar/excluir variante na tela, o Save dizia "Product saved" e NADA
    // era gravado — o trabalho sumia ao recarregar. Linha sem `codigo` é ignorada
    // (coluna NOT NULL no banco).
    // NAO usa delete+insert como as outras filhas. `pedido_itens.variante_id`
    // referencia esta tabela com ON DELETE SET NULL (20260802130000:29): apagar e
    // recriar gera `id` NOVO e ZERA o vinculo dos pedidos daquele produto — a cada
    // Save. Era por isso que `pedido_itens.variante_id` estava 100% nulo em
    // producao (o sync fazia o mesmo, de hora em hora, e ja foi corrigido).
    //
    // Casamento por `id` (a linha carregada do banco no fetchProduct ja o traz),
    // NAO por `codigo`: assim o admin pode RENOMEAR o codigo de uma variante sem
    // que ela seja tratada como "apagou uma, criou outra" — o vinculo do pedido
    // sobrevive ao rename.
    const variantesValidas = variants.filter(v => (v.codigo ?? "").trim());
    const campos = (v: any) => ({
      codigo: String(v.codigo).trim(),
      ativo: v.ativo ?? true,
      // Validado ANTES do save (ver `handleSave`): aqui ja e numero.
      // Antes era `Number(x) || 0`, que ZERAVA o estoque da variante em silencio
      // — digitar algo invalido, ou apagar o campo por engano, gravava 0. E
      // depois de 20260825320000 zero significa "tamanho esgotado" para o
      // cliente.
      quantidade: Math.trunc(Number(v.quantidade)),
      imagem_url: v.imagem_url || null,
      valores_opcao: v.valores_opcao ?? [],
    });

    // Apaga só as que o admin REMOVEU da tela (sumiram da lista de ids).
    const idsNaTela = new Set(variantesValidas.map(v => v.id).filter(Boolean));
    const { data: varExistentes, error: varLerErr } = await supabase
      .from("produto_variantes").select("id").eq("produto_id", pid);
    if (varLerErr) throw new Error("Failed to read variants: " + varLerErr.message);
    const varObsoletas = (varExistentes ?? []).map((v: any) => v.id).filter((id: string) => !idsNaTela.has(id));
    if (varObsoletas.length > 0) {
      const { error } = await supabase.from("produto_variantes").delete().in("id", varObsoletas);
      if (error) throw new Error("Failed to remove variants: " + error.message);
    }

    // O `id` da variante recem-criada volta pro state. Sem isso, ela continua sem
    // `id` na memoria: um SEGUNDO Save na MESMA sessao a trataria como "nova" de
    // novo -> ela cairia em `varObsoletas`, seria apagada e recriada com id novo,
    // e o vinculo do pedido quebraria — exatamente o bug que este bloco corrige.
    // Chave = a PROPRIA LINHA (referencia do objeto), nunca a posicao. Os inputs da
    // tabela nao ficam desabilitados durante o save, entao o admin pode apagar ou
    // editar uma linha no meio das gravacoes; por indice, o id novo acabaria colado
    // numa linha que JA tem id — duas linhas com o mesmo id, pior que o bug
    // original. Por referencia, no maximo o id se perde (a linha sumiu).
    // `filter` preserva a referencia e os handlers mutam o objeto in-place, entao a
    // identidade sobrevive a digitacao.
    const idsNovos = new Map<any, string>();
    // `finally`: aplica os ids JA obtidos mesmo se um insert falhar no meio. Sem
    // isso, as variantes ja inseridas ficavam sem id no state e o proximo Save as
    // DUPLICARIA (nao ha UNIQUE em produto_id+codigo).
    try {
      for (const v of variantesValidas) {
        if (v.id) {
          // `.eq("produto_id", pid)` junto do id: o UPDATE por id sozinho alcanca
          // QUALQUER variante do banco. `v.id` vem do state, e state que nao
          // corresponde mais ao produto da tela grava estoque e preco no produto
          // errado — sem erro nenhum, porque a linha existe. Com o par, um id
          // estranho ao produto atualiza zero linhas em vez da linha errada.
          const { error } = await supabase.from("produto_variantes")
            .update(campos(v)).eq("id", v.id).eq("produto_id", pid);
          if (error) throw new Error("Failed to save variants: " + error.message);
        } else {
          const { data, error } = await supabase.from("produto_variantes")
            .insert({ produto_id: pid, ...campos(v) }).select("id").single();
          if (error) throw new Error("Failed to save variants: " + error.message);
          if (data?.id) idsNovos.set(v, data.id as string);
        }
      }
    } finally {
      if (idsNovos.size > 0) {
        setVariants((prev: any[]) => prev.map((v: any) => idsNovos.has(v) ? { ...v, id: idsNovos.get(v) } : v));
      }
    }

    // Access: grupos (em privacy_group_id + grupo_nome p/ compat) e grant/exclude por cliente.
    // CHECA erro nos inserts de privacidade: se falhar após o delete, o produto privado
    // ficaria sem acesso nenhum (vazamento/sumiço). Lança -> handleSave avisa e o admin
    // reenvia (o estado ainda está em memória, nada é perdido de verdade).
    await delOrFail("produto_acesso", "access groups");
    if (form.is_private && accGroups.size > 0) {
      const { error: accErr } = await supabase.from("produto_acesso").insert(
        [...accGroups].map((gid) => ({
          produto_id: pid,
          privacy_group_id: gid,
          grupo_nome: privacyGroups.find((p) => p.id === gid)?.nome ?? null,
        })) as any,
      );
      if (accErr) throw new Error("Failed to save access groups (privacy): " + accErr.message);
    }
    await delOrFail("produto_cliente_acesso", "customer access");
    const cliRows = form.is_private
      ? [
          ...accGrant.map((cid) => ({ produto_id: pid, cliente_id: cid, tipo: "grant" })),
          ...accExclude.map((cid) => ({ produto_id: pid, cliente_id: cid, tipo: "exclude" })),
        ]
      : [];
    if (cliRows.length > 0) {
      const { error: cliErr } = await (supabase as any).from("produto_cliente_acesso").insert(cliRows);
      if (cliErr) throw new Error("Failed to save per-customer access (privacy): " + cliErr.message);
    }
  };

  const f = (key: string, val: any) => setForm(prev => ({ ...prev, [key]: val }));

  if (loading) return (
    <AdminLayout>
      <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
    </AdminLayout>
  );

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin/products")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="font-display text-xl font-semibold">
              {isNew ? "New Product" : `Editing product: ${form.nome}`}
            </h2>
            {!isNew && (
              <p className="text-xs text-muted-foreground">
                Created: {meta.created_at ? new Date(meta.created_at).toLocaleDateString() : "—"} · Last update: {meta.updated_at ? new Date(meta.updated_at).toLocaleDateString() : "—"}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/admin/products")}>Cancel</Button>
          <Button onClick={() => handleSave(true)} disabled={saving || falhouCarregar.length > 0} className="gap-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
          {!isNew && (
            <Button variant="secondary" onClick={() => handleSave(false)} disabled={saving || falhouCarregar.length > 0}>
              Save and stay on page
            </Button>
          )}
        </div>
      </div>

      {/* BANNER FIXO, fora das abas. O toast some em segundos e depois nao sobra
          sinal nenhum: as abas afirmam em prosa "No gallery images" / "uses the
          default wholesale price", e o admin trabalha vinte minutos antes de
          descobrir no Save. Aqui ele ve antes de comecar. Sem botao de "tentar de
          novo" de proposito: recarregar os dados reescreve o formulario inteiro e
          jogaria fora o que ele digitou — F5 e a mesma coisa, e ele decide. */}
      {falhouCarregar.length > 0 && (
        <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm font-semibold text-destructive">
            Saving is blocked — this product's data did not load completely.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Failed to load: {falhouCarregar.join(", ")}. What you see below is incomplete,
            and saving would erase the parts that are missing. Reload the page.
          </p>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1 mb-4">
          <TabsTrigger value="product">Product</TabsTrigger>
          <TabsTrigger value="discounts">Discounts</TabsTrigger>
          <TabsTrigger value="customer-prices">Customer Prices</TabsTrigger>
          <TabsTrigger value="related">Related Products</TabsTrigger>
          <TabsTrigger value="options">Product Options</TabsTrigger>
          <TabsTrigger value="variants">Code & Price Variants</TabsTrigger>
          <TabsTrigger value="promotion">Promotion</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
          <TabsTrigger value="price-lists">Price Lists</TabsTrigger>
          <TabsTrigger value="status-rules">Product Status Rules</TabsTrigger>
          <TabsTrigger value="access">Access</TabsTrigger>
        </TabsList>

        {/* ========== PRODUCT TAB ========== */}
        <TabsContent value="product">
          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            {/* Left column */}
            <div className="space-y-6">
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-1">
                      <Label>Name *</Label>
                      <Input value={form.nome} onChange={e => f("nome", e.target.value)} />
                    </div>
                    <div>
                      <Label>Code</Label>
                      <Input value={form.sku} onChange={e => f("sku", e.target.value)} />
                    </div>
                    <div>
                      <Label>Category *</Label>
                      <Select value={form.categoria_id} onValueChange={v => f("categoria_id", v)}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>{categoryTreeOptions(categorias).map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label>Description</Label>
                    <textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[160px]"
                      value={form.descricao} onChange={e => f("descricao", e.target.value)} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Image</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex items-start gap-4">
                    {form.imagem_url ? (
                      <img src={form.imagem_url} alt="Product" className="h-32 w-32 rounded-lg object-cover border" />
                    ) : (
                      <div className="flex h-32 w-32 items-center justify-center rounded-lg border bg-muted">
                        <ImageIcon className="h-10 w-10 text-muted-foreground" />
                      </div>
                    )}
                    <div className="space-y-2">
                      <label className="cursor-pointer">
                        <div className="flex items-center gap-2 rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
                          <Upload className="h-4 w-4" />{uploading ? "Uploading..." : "Select main image"}
                        </div>
                        <input type="file" accept="image/*" className="hidden" onChange={e => handleImageUpload(e, "main")} disabled={uploading} />
                      </label>
                      {form.imagem_url && (
                        <Button variant="ghost" size="sm" onClick={() => f("imagem_url", "")} className="text-destructive">
                          <Trash2 className="h-3 w-3 mr-1" /> Remove
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Dimensions</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-3">
                    <div><Label>Weight</Label><Input type="number" step="0.01" value={form.peso} onChange={e => f("peso", parseFloat(e.target.value) || 0)} /></div>
                    <div><Label>Length</Label><Input type="number" step="0.01" value={form.comprimento} onChange={e => f("comprimento", parseFloat(e.target.value) || 0)} /></div>
                    <div><Label>Width</Label><Input type="number" step="0.01" value={form.largura} onChange={e => f("largura", parseFloat(e.target.value) || 0)} /></div>
                    <div><Label>Height</Label><Input type="number" step="0.01" value={form.altura} onChange={e => f("altura", parseFloat(e.target.value) || 0)} /></div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right column */}
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div>
                    <Label>Brand</Label>
                    <Select value={form.brand_id} onValueChange={v => f("brand_id", v)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{brands.map(b => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-primary">MSRP</Label>
                      <Input type="number" step="0.01" value={form.preco_msrp} onChange={e => f("preco_msrp", parseFloat(e.target.value) || 0)} />
                    </div>
                    <div>
                      <Label className="text-primary">Cost</Label>
                      <Input type="number" step="0.01" value={form.custo} onChange={e => f("custo", parseFloat(e.target.value) || 0)} />
                    </div>
                  </div>

                  <div>
                    <Label className="text-primary">Wholesale Price</Label>
                    <Input type="number" step="0.01" value={form.preco} onChange={e => f("preco", parseFloat(e.target.value) || 0)} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Minimum Quantity</Label><Input type="number" value={form.quantidade_minima} onChange={e => f("quantidade_minima", parseInt(e.target.value) || 0)} /></div>
                    <div><Label>Maximum Quantity</Label><Input type="number" value={form.quantidade_maxima} onChange={e => f("quantidade_maxima", parseInt(e.target.value) || 0)} /></div>
                  </div>

                  <div>
                    <Label>Quantity (Stock)</Label>
                    <Input type="number" value={form.estoque_total} onChange={e => f("estoque_total", parseInt(e.target.value) || 0)} />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox checked={form.rastrear_estoque} onCheckedChange={v => f("rastrear_estoque", !!v)} />
                      <Label className="text-sm">Track Inventory</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox checked={form.permitir_backorder} onCheckedChange={v => f("permitir_backorder", !!v)} />
                      <Label className="text-sm">Allow Backorder</Label>
                    </div>
                  </div>

                  <div>
                    <Label>Box Quantity / Multiples</Label>
                    <Input type="number" value={form.quantidade_caixa} onChange={e => f("quantidade_caixa", parseInt(e.target.value) || 0)} />
                  </div>

                  <div>
                    <Label>Status</Label>
                    <Select value={form.status_produto} onValueChange={v => f("status_produto", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{statusOptions.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Estimated Availability Date</Label>
                    <Input type="date" value={form.data_disponibilidade?.split("T")[0] ?? ""} onChange={e => f("data_disponibilidade", e.target.value)} />
                  </div>

                  <div>
                    <Label>Unit of Sale</Label>
                    <Input value={form.unidade_venda} onChange={e => f("unidade_venda", e.target.value)} />
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t">
                    <Checkbox checked={form.ativo} onCheckedChange={v => f("ativo", !!v)} />
                    <Label className="text-sm font-medium">Is Active?</Label>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ========== DISCOUNTS TAB ========== */}
        <TabsContent value="discounts">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Product Discounts</CardTitle>
              <Button size="sm" onClick={() => setDiscounts([...discounts, { tabela_preco_id: "", percentual: 0, preco_final: null, quantidade_minima: 0, data_inicio: null, data_fim: null }])}>
                <Plus className="h-3 w-3 mr-1" /> Add Discount
              </Button>
            </CardHeader>
            <CardContent>
              {discounts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No discounts configured. Click "Add Discount" to create one.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {/* Obrigatório: desconto por quantidade é SEMPRE por tabela de
                          preço (decisão do cliente, 03/ago). Não existe "vale pra todas". */}
                      <TableHead>Price List *</TableHead><TableHead>From Qty</TableHead>
                      <TableHead>Percentage (%)</TableHead><TableHead>Date From</TableHead>
                      <TableHead>Date To</TableHead><TableHead>Final Price</TableHead><TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {discounts.map((d, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Select value={d.tabela_preco_id} onValueChange={v => { const nd = [...discounts]; nd[i].tabela_preco_id = v; setDiscounts(nd); }}>
                            <SelectTrigger className={`w-40 ${d.tabela_preco_id ? "" : "border-destructive"}`}>
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>{tabelasPreco.map(tp => <SelectItem key={tp.id} value={tp.id}>{tp.nome}</SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell><Input type="number" className="w-20" value={d.quantidade_minima} onChange={e => { const nd = [...discounts]; nd[i].quantidade_minima = parseInt(e.target.value) || 0; setDiscounts(nd); }} /></TableCell>
                        <TableCell><Input type="number" step="0.01" className="w-20" value={d.percentual} onChange={e => { const nd = [...discounts]; nd[i].percentual = parseFloat(e.target.value) || 0; setDiscounts(nd); }} /></TableCell>
                        <TableCell><Input type="date" className="w-36" value={d.data_inicio?.split("T")[0] ?? ""} onChange={e => { const nd = [...discounts]; nd[i].data_inicio = e.target.value || null; setDiscounts(nd); }} /></TableCell>
                        <TableCell><Input type="date" className="w-36" value={d.data_fim?.split("T")[0] ?? ""} onChange={e => { const nd = [...discounts]; nd[i].data_fim = e.target.value || null; setDiscounts(nd); }} /></TableCell>
                        <TableCell><Input type="number" step="0.01" className="w-24" value={d.preco_final ?? ""} onChange={e => { const nd = [...discounts]; nd[i].preco_final = parseFloat(e.target.value) || null; setDiscounts(nd); }} /></TableCell>
                        <TableCell><Button variant="ghost" size="icon" onClick={() => setDiscounts(discounts.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== CUSTOMER PRICES TAB ========== */}
        <TabsContent value="customer-prices">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Customer Prices</CardTitle>
              <Button size="sm" onClick={() => setCustomerPrices([...customerPrices, { cliente_id: "", preco: 0, aplicar_descontos_extras: false }])}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </CardHeader>
            <CardContent>
              {customerPrices.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No customer-specific prices. Click "Add" to create one.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Price</TableHead><TableHead>Apply Extra Discounts</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {customerPrices.map((cp, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Select value={cp.cliente_id} onValueChange={v => { const n = [...customerPrices]; n[i].cliente_id = v; setCustomerPrices(n); }}>
                            <SelectTrigger className="w-52"><SelectValue placeholder="Select customer" /></SelectTrigger>
                            <SelectContent>{clientes.map(c => <SelectItem key={c.id} value={c.id}>{c.nome} - {c.empresa}</SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell><Input type="number" step="0.01" className="w-28" value={cp.preco} onChange={e => { const n = [...customerPrices]; n[i].preco = parseFloat(e.target.value) || 0; setCustomerPrices(n); }} /></TableCell>
                        <TableCell>
                          <Checkbox checked={cp.aplicar_descontos_extras} onCheckedChange={v => { const n = [...customerPrices]; n[i].aplicar_descontos_extras = !!v; setCustomerPrices(n); }} />
                        </TableCell>
                        <TableCell><Button variant="ghost" size="icon" onClick={() => setCustomerPrices(customerPrices.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== RELATED PRODUCTS TAB ========== */}
        <TabsContent value="related">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Related / Bundled Products</CardTitle>
              <Button size="sm" onClick={() => setRelatedProducts([...relatedProducts, { produto_relacionado_id: "", comprar_junto: false }])}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </CardHeader>
            <CardContent>
              {relatedProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No related products. Click "Add" to link products.</p>
              ) : (
                <div className="space-y-2">
                  {relatedProducts.map((rp, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                      <div className="relative flex-1">
                        <Input
                          placeholder="Search product by name or code..."
                          value={relOpenIdx === i ? relQuery : prodName(rp.produto_relacionado_id)}
                          onFocus={() => { setRelOpenIdx(i); setRelQuery(prodName(rp.produto_relacionado_id)); }}
                          onChange={e => { setRelOpenIdx(i); setRelQuery(e.target.value); }}
                        />
                        {relOpenIdx === i && (
                          <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border bg-popover shadow-md">
                            {allProducts
                              .filter(p => p.id !== id && `${p.nome} ${p.sku ?? ""}`.toLowerCase().includes(relQuery.toLowerCase()))
                              .filter(p => !relatedProducts.some((r, ri) => ri !== i && r.produto_relacionado_id === p.id))
                              .slice(0, 20)
                              .map(p => (
                                <button
                                  key={p.id}
                                  type="button"
                                  className="block w-full text-left px-3 py-2 text-sm hover:bg-muted"
                                  onClick={() => { const n = [...relatedProducts]; n[i].produto_relacionado_id = p.id; setRelatedProducts(n); setRelOpenIdx(null); setRelQuery(""); }}
                                >
                                  {p.nome}{p.sku && <span className="text-xs text-muted-foreground"> ({p.sku})</span>}
                                </button>
                              ))}
                            {allProducts.filter(p => p.id !== id && `${p.nome} ${p.sku ?? ""}`.toLowerCase().includes(relQuery.toLowerCase())).length === 0 && (
                              <p className="px-3 py-2 text-sm text-muted-foreground">No products found.</p>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox checked={rp.comprar_junto} onCheckedChange={v => { const n = [...relatedProducts]; n[i].comprar_junto = !!v; setRelatedProducts(n); }} />
                        <Label className="text-xs">Buy Together</Label>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => setRelatedProducts(relatedProducts.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== PRODUCT OPTIONS TAB ========== */}
        <TabsContent value="options">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Product Options</CardTitle>
              <Button size="sm" onClick={() => setAssignedOptions([...assignedOptions, { option_id: "" }])}>
                <Plus className="h-3 w-3 mr-1" /> Add Option
              </Button>
            </CardHeader>
            <CardContent>
              {assignedOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No options assigned. Click "Add Option" to assign one (max 2).</p>
              ) : (
                <div className="space-y-2">
                  {assignedOptions.map((o, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                      <Select value={o.option_id} onValueChange={v => { const n = [...assignedOptions]; n[i].option_id = v; setAssignedOptions(n); }}>
                        <SelectTrigger className="w-60"><SelectValue placeholder="Select option" /></SelectTrigger>
                        <SelectContent>{productOptions.map(po => <SelectItem key={po.id} value={po.id}>{po.nome} ({po.tipo})</SelectItem>)}</SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" onClick={() => setAssignedOptions(assignedOptions.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== CODE & PRICE VARIANTS TAB ========== */}
        <TabsContent value="variants">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Code & Price Variants</CardTitle>
              <Button size="sm" onClick={() => setVariants([...variants, { codigo: "", ativo: true, quantidade: 0, imagem_url: "", valores_opcao: [] }])}>
                <Plus className="h-3 w-3 mr-1" /> Add Variant
              </Button>
            </CardHeader>
            <CardContent>
              {variants.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No variants. Assign Product Options first, then create variants here.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Active</TableHead><TableHead>Code</TableHead><TableHead>Quantity</TableHead><TableHead /><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {variants.map((v, i) => (
                      <TableRow key={i}>
                        <TableCell><Checkbox checked={v.ativo} onCheckedChange={val => { const n = [...variants]; n[i].ativo = !!val; setVariants(n); }} /></TableCell>
                        <TableCell><Input value={v.codigo} onChange={e => { const n = [...variants]; n[i].codigo = e.target.value; setVariants(n); }} className="w-40" /></TableCell>
                        <TableCell><Input type="number" value={v.quantidade} onChange={e => { const n = [...variants]; n[i].quantidade = parseInt(e.target.value) || 0; setVariants(n); }} className="w-24" /></TableCell>
                        <TableCell><Button variant="ghost" size="icon" onClick={() => setVariants(variants.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== PROMOTION TAB ========== */}
        <TabsContent value="promotion">
          <Card>
            <CardHeader><CardTitle className="text-base">Promotion Settings</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Checkbox checked={form.promover_categoria} onCheckedChange={v => f("promover_categoria", !!v)} />
                <Label>Promote in category page</Label>
              </div>
              <p className="text-xs text-muted-foreground ml-6">Show product on top of its category products list</p>

              <div className="flex items-center gap-2">
                <Checkbox checked={form.promover_destaque} onCheckedChange={v => f("promover_destaque", !!v)} />
                <Label>Promote in front page</Label>
              </div>
              <p className="text-xs text-muted-foreground ml-6">Show product in the "Featured Products" section on the storefront home page</p>

              <div>
                <Label>Show in Deals page</Label>
                <Select value={form.mostrar_ofertas} onValueChange={v => f("mostrar_ofertas", v)}>
                  <SelectTrigger className="w-72 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{ofertasOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== IMAGES TAB ========== */}
        <TabsContent value="images">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Gallery Images</CardTitle>
              <label className="cursor-pointer">
                <Button size="sm" asChild><span><Upload className="h-3 w-3 mr-1" /> Upload Image</span></Button>
                <input type="file" accept="image/*" className="hidden" onChange={e => handleImageUpload(e, "gallery")} disabled={uploading} />
              </label>
            </CardHeader>
            <CardContent>
              {galleryImages.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No gallery images. Upload images to show on the product page.</p>
              ) : (
                <div className="grid grid-cols-4 gap-4">
                  {galleryImages.map((img, i) => (
                    <div key={i} className="relative group">
                      <img src={img.imagem_url} alt={`Gallery ${i}`} className="h-32 w-full rounded-lg object-cover border" />
                      <Button variant="destructive" size="icon" className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => setGalleryImages(galleryImages.filter((_, idx) => idx !== i))}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== FILES TAB ========== */}
        <TabsContent value="files">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Product Files</CardTitle>
              <label className="cursor-pointer">
                <Button size="sm" asChild><span><Upload className="h-3 w-3 mr-1" /> Upload File</span></Button>
                <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} />
              </label>
            </CardHeader>
            <CardContent>
              {files.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No files attached. Upload PDFs, documents or other files.</p>
              ) : (
                <div className="space-y-2">
                  {files.map((file, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <Input value={file.titulo} onChange={e => { const n = [...files]; n[i].titulo = e.target.value; setFiles(n); }} className="flex-1" />
                      <a href={file.arquivo_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">View</a>
                      <Button variant="ghost" size="icon" onClick={() => setFiles(files.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== ADVANCED TAB ========== */}
        <TabsContent value="advanced">
          <Card>
            <CardHeader><CardTitle className="text-base">Advanced Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div><Label>UPC Code</Label><Input value={form.codigo_upc} onChange={e => f("codigo_upc", e.target.value)} /></div>
                <div><Label>Barcode</Label><Input value={form.barcode} onChange={e => f("barcode", e.target.value)} /></div>
                <div><Label>Reference Code</Label><Input value={form.codigo_referencia} onChange={e => f("codigo_referencia", e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Package Quantity</Label><Input type="number" value={form.quantidade_pacote} onChange={e => f("quantidade_pacote", parseInt(e.target.value) || 0)} /></div>
                <div><Label>Tag Line</Label><Input value={form.tag_line} onChange={e => f("tag_line", e.target.value)} /></div>
              </div>
              <div>
                <Label>Meta Description</Label>
                <textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
                  value={form.meta_descricao} onChange={e => f("meta_descricao", e.target.value)} />
              </div>
              <div>
                <Label>PDF Catalog Description</Label>
                <textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
                  value={form.descricao_pdf} onChange={e => f("descricao_pdf", e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== PRICE LISTS TAB ========== */}
        <TabsContent value="price-lists">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Price Lists</CardTitle>
              <Button size="sm" onClick={() => setPriceLists([...priceLists, { tabela_preco_id: "", preco: 0 }])}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </CardHeader>
            <CardContent>
              {priceLists.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No price list overrides. Product uses the default wholesale price for all price lists.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Price List</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {priceLists.map((pl, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Select value={pl.tabela_preco_id} onValueChange={v => { const n = [...priceLists]; n[i].tabela_preco_id = v; setPriceLists(n); }}>
                            <SelectTrigger className="w-52"><SelectValue placeholder="Select price list" /></SelectTrigger>
                            <SelectContent>{tabelasPreco.map(tp => <SelectItem key={tp.id} value={tp.id}>{tp.nome}</SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input type="number" step="0.01" className="w-32" value={pl.preco} onChange={e => { const n = [...priceLists]; n[i].preco = parseFloat(e.target.value) || 0; setPriceLists(n); }} />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => setPriceLists(priceLists.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== PRODUCT STATUS RULES TAB ========== */}
        <TabsContent value="status-rules">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Product Status Rules</CardTitle>
              <Button size="sm" onClick={() => setStatusRules([...statusRules, { status_nome: "", regra_tipo: "quantidade", valor_limite: 0 }])}>
                <Plus className="h-3 w-3 mr-1" /> Add Rule
              </Button>
            </CardHeader>
            <CardContent>
              {statusRules.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No status rules configured. Add rules to automatically change product status based on inventory.</p>
              ) : (
                <div className="space-y-2">
                  {statusRules.map((sr, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                      <Select value={sr.status_nome} onValueChange={v => { const n = [...statusRules]; n[i].status_nome = v; setStatusRules(n); }}>
                        <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
                        <SelectContent>{statusOptions.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <span className="text-sm text-muted-foreground">when quantity ≤</span>
                      <Input type="number" className="w-24" value={sr.valor_limite} onChange={e => { const n = [...statusRules]; n[i].valor_limite = parseInt(e.target.value) || 0; setStatusRules(n); }} />
                      <Button variant="ghost" size="icon" onClick={() => setStatusRules(statusRules.filter((_, idx) => idx !== i))}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== ACCESS TAB (privacidade — modelo B2BWave) ========== */}
        <TabsContent value="access">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Lock className="h-4 w-4 text-amber-500" /> Access</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <Checkbox checked={form.is_private} onCheckedChange={(v) => f("is_private", v === true)} />
                Private — visible only to selected customers
              </label>

              {form.is_private && (
                <div className="space-y-4 pl-1">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Privacy groups</p>
                    <div className="flex flex-wrap gap-2">
                      {privacyGroups.length === 0 && <span className="text-xs text-muted-foreground">No privacy groups yet.</span>}
                      {privacyGroups.map((pg) => (
                        <label key={pg.id} className="flex items-center gap-1.5 text-sm border rounded px-2 py-1 cursor-pointer">
                          <Checkbox
                            checked={accGroups.has(pg.id)}
                            onCheckedChange={(v) => setAccGroups((prev) => {
                              const s = new Set(prev);
                              if (v === true) s.add(pg.id); else s.delete(pg.id);
                              return s;
                            })}
                          />
                          {pg.nome}
                        </label>
                      ))}
                    </div>
                  </div>

                  {([
                    { label: "Grant access to specific customers", sel: accGrant, set: setAccGrant },
                    { label: "Exclude customers from accessing product", sel: accExclude, set: setAccExclude },
                  ] as const).map(({ label, sel, set }) => {
                    const available = clientes.filter((c) => !sel.includes(c.id));
                    return (
                      <div key={label}>
                        <p className="text-xs text-muted-foreground mb-1">{label}</p>
                        <Select value="" onValueChange={(v) => v && set([...sel, v])}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Add customer…" /></SelectTrigger>
                          <SelectContent className="max-h-64">
                            {available.length === 0
                              ? <div className="px-2 py-1.5 text-sm text-muted-foreground">No more customers</div>
                              : available.map((c) => <SelectItem key={c.id} value={c.id}>{c.empresa || c.nome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {sel.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {sel.map((cid) => {
                              const c = clientes.find((x) => x.id === cid);
                              return (
                                <Badge key={cid} variant="secondary" className="gap-1">
                                  {c?.empresa || c?.nome || cid}
                                  <button type="button" onClick={() => set(sel.filter((x) => x !== cid))}><X className="h-3 w-3" /></button>
                                </Badge>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
};

export default ProductEdit;
