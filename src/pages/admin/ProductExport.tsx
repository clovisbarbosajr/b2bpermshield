import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { exportToCSV } from "@/lib/export-csv";

import { fetchAllRows } from "@/lib/fetchAllRows";
import { valorOr } from "@/lib/postgrestOr";
// Os nomes de coluna FIXOS do formato B2BWave, na ordem em que este arquivo os
// escreve. Uma regua de preco com um destes nomes colide com a coluna fixa; ver o
// desempate em `rows`.
const COLUNAS_FIXAS = [
  "product_sku", "category_path", "product_name", "product_desc",
  "length", "width", "height", "brand", "product_unit", "product_active",
  "quantity", "quantity_monitor", "can_backorder", "minimum_quantity",
  "maximum_quantity", "box_quantity", "barcode", "reference_code", "product_upc",
];

const AdminProductExport = () => {
  const [priceLists, setPriceLists] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [privacyGroups, setPrivacyGroups] = useState<any[]>([]);
  const [selectedPriceList, setSelectedPriceList] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedPrivacyGroup, setSelectedPrivacyGroup] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("tabelas_preco").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("categorias").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("privacy_groups").select("id, nome").eq("ativo", true).order("nome"),
    ]).then(([pl, cat, pg]) => {
      setPriceLists(pl.data ?? []);
      setCategories(cat.data ?? []);
      setPrivacyGroups(pg.data ?? []);
    });
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      // PAGINADO. Antes era um `.select()` solto: o PostgREST corta em 1000
      // linhas SEM erro, entao o CSV saia com 1000 produtos e cara de completo.
      //
      // Isto aqui e o UNICO caminho de saida de dados do sistema. Um backup que
      // silenciosamente perde tudo acima da linha 1000 e pior que backup nenhum:
      // com nenhum voce sabe que nao tem; com este voce acha que tem.
      //
      // `.order("id")` e obrigatorio — `.range()` vira LIMIT/OFFSET, e no
      // Postgres LIMIT/OFFSET sem ORDER BY nao tem ordem definida: linha
      // repetida numa pagina e faltando na outra.
      const products = await fetchAllRows<any>((from, to) => {
        let q = supabase.from("produtos").select("*, categorias(nome)")
          .order("id", { ascending: true }).range(from, to);
        if (selectedCategory !== "all") q = q.eq("categoria_id", selectedCategory);
        return q;
      });
      if (!products?.length) { toast.error("No products found"); setExporting(false); return; }

      // Fetch price list items if specific price list selected
      // Chaveados por ID da tabela de preco; `rotulos` guarda o nome so para o
      // cabecalho do CSV.
      let priceMap: Record<string, Record<string, number>> = {};
      let priceListNames: string[] = [];
      let rotulos: Record<string, string> = {};

      if (selectedPriceList === "all") {
        // Paginado pelo mesmo motivo: com varias tabelas de preco, `tabela_preco_itens`
        // passa de 1000 linhas facil, e o corte silencioso zera o preco de parte
        // dos produtos NO CSV — sem nenhum aviso.
        // `ativo` JUNTO: desativar uma tabela nao apaga os itens dela, e o join
        // to-one do PostgREST traz a inativa igual. O dropdown ja filtra
        // `ativo=true` — o ramo "all" ficava incoerente com a propria tela e o CSV
        // saia com uma coluna de regua MORTA, com preco obsoleto, indistinguivel
        // das vivas. E o sync do B2BWave desativa sozinho
        // (`b2bwave-sync:1822`), entao isso acontece sem ninguem fazer nada aqui.
        const allItems = await fetchAllRows<any>((from, to) =>
          supabase.from("tabela_preco_itens")
            .select("id, produto_id, preco, tabela_preco_id, tabelas_preco(nome, ativo)")
            .order("id", { ascending: true }).range(from, to));
        // CHAVE PELO ID, e nao pelo nome. `tabelas_preco.nome` nao tem UNIQUE, e o
        // proprio `handleDuplicate` gera `"<nome> (copy)"` sem contador — duas
        // reguas de mesmo nome viravam UMA coluna com os precos misturados, linha
        // a linha, conforme a ordem de leitura. O nome fica so como rotulo.
        const rotuloDaTabela: Record<string, string> = {};
        (allItems ?? []).forEach((item: any) => {
          if (item.tabelas_preco?.ativo === false) return;
          const plId = item.tabela_preco_id;
          if (!priceMap[plId]) priceMap[plId] = {};
          priceMap[plId][item.produto_id] = item.preco;
          if (!priceListNames.includes(plId)) {
            priceListNames.push(plId);
            rotuloDaTabela[plId] = item.tabelas_preco?.nome || plId;
          }
        });
        rotulos = rotuloDaTabela;
      } else {
        // CONFERE QUE A REGUA AINDA ESTA ATIVA, na hora do export.
        //
        // O dropdown filtra `ativo = true`, mas e carregado UMA vez no mount e
        // nunca mais. O sync do B2BWave desativa regua sozinho
        // (`b2bwave-sync:1822'), entao com a tela aberta durante um sync a opcao
        // continua la e o export saia com preco de regua MORTA — o mesmo defeito
        // que o ramo "all" acabou de fechar, so que por outro caminho. Aproveita
        // e usa o nome fresco no cabecalho, em vez do lido no mount.
        const { data: viva, error: vErr } = await supabase.from("tabelas_preco")
          .select("nome").eq("id", selectedPriceList).eq("ativo", true).maybeSingle();
        if (vErr) { toast.error("Could not check the price list: " + vErr.message); setExporting(false); return; }
        if (!viva) {
          toast.error("That price list is no longer active — reload the page and pick another one. Nothing was exported.");
          setExporting(false);
          return;
        }
        priceListNames = [selectedPriceList];
        rotulos = { [selectedPriceList]: viva.nome || selectedPriceList };
        const items = await fetchAllRows<any>((from, to) =>
          supabase.from("tabela_preco_itens").select("id, produto_id, preco")
            .eq("tabela_preco_id", selectedPriceList)
            .order("id", { ascending: true }).range(from, to));
        priceMap[selectedPriceList] = {};
        (items ?? []).forEach((item: any) => { priceMap[selectedPriceList][item.produto_id] = item.preco; });
      }

      // If privacy group selected, filter by produto_acesso
      let filteredProducts = products;
      if (selectedPrivacyGroup) {
        const pg = privacyGroups.find(g => g.id === selectedPrivacyGroup);
        if (pg) {
          // Casa pelo ID do grupo E pelo nome: `ProductEdit` grava os dois
          // (`privacy_group_id` e `grupo_nome`), e ha dado legado com UUID
          // gravado no campo de nome. Filtrar so por nome perdia esses produtos
          // do export, calado.
          const access = await fetchAllRows<any>((from, to) =>
            supabase.from("produto_acesso").select("id, produto_id")
              .or(`privacy_group_id.eq.${valorOr(pg.id)},grupo_nome.eq.${valorOr(pg.nome)},grupo_nome.eq.${valorOr(pg.id)}`)
              .order("id", { ascending: true }).range(from, to));
          const accessIds = new Set((access ?? []).map((a: any) => a.produto_id));
          filteredProducts = products.filter(p => accessIds.has(p.id));
        }
      }

      // Build export rows matching B2B Wave format
      const rows = filteredProducts.map(p => {
        const row: Record<string, any> = {
          product_sku: p.sku,
          category_path: (p.categorias as any)?.nome || "",
          product_name: p.nome,
          product_desc: p.descricao || "",
        };
        priceListNames.forEach(plId => {
          // O ROTULO vai para o cabecalho; a CHAVE continua sendo o id, entao duas
          // reguas de mesmo nome viram duas colunas em vez de uma misturada. Se os
          // rotulos empatarem, o id desempata — o CSV nao pode ter duas colunas
          // com o mesmo cabecalho.
          const nome = rotulos[plId] || plId;
          // O desempate compara com as OUTRAS REGUAS **e com as colunas fixas**.
          // `exportToCSV` e chamado sem `columns`, entao as colunas saem de
          // `Object.keys(row)` — uma regua chamada `product_sku` nao virava duas
          // colunas, virava UMA: o preco entrava por cima do SKU (e o
          // `Object.assign` abaixo nao restaura), ou o `Object.assign` entrava
          // por cima do preco quando o nome batia com `length`, `brand`,
          // `quantity`... Nos dois casos o CSV sai com cabecalho certo e valor
          // errado, sem diferenca nenhuma na contagem de colunas.
          const repetido = COLUNAS_FIXAS.includes(nome)
            || priceListNames.filter((o) => (rotulos[o] || o) === nome).length > 1;
          row[repetido ? `${nome} (${plId.slice(0, 8)})` : nome] = priceMap[plId]?.[p.id] ?? "";
        });
        Object.assign(row, {
          length: p.comprimento || "",
          width: p.largura || "",
          height: p.altura || "",
          brand: "",
          product_unit: p.unidade_venda,
          product_active: p.ativo ? 1 : 0,
          quantity: p.estoque_total,
          quantity_monitor: p.rastrear_estoque ? 1 : 0,
          can_backorder: p.permitir_backorder ? 1 : 0,
          minimum_quantity: p.quantidade_minima,
          maximum_quantity: p.quantidade_maxima || "",
          box_quantity: p.quantidade_caixa || "",
          barcode: p.barcode || "",
          reference_code: p.codigo_referencia || "",
          product_upc: p.codigo_upc || "",
        });
        return row;
      });

      // Log export
      await supabase.from("export_logs").insert({ tipo: "Products", status: "concluido", registros: rows.length });

      const plLabel = selectedPriceList === "all" ? "All-PriceLists" : priceLists.find(p => p.id === selectedPriceList)?.nome || "PriceList";
      const catLabel = selectedCategory === "all" ? "All-Categories" : categories.find(c => c.id === selectedCategory)?.nome || "Category";
      exportToCSV(rows, `${catLabel}-${plLabel}`);
      toast.success(`${rows.length} products exported`);
    } catch (err: any) {
      toast.error(err.message);
    }
    setExporting(false);
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Products export</h2>
      </div>
      <div className="space-y-5 max-w-4xl">
        <div>
          <Label className="text-primary">Price List *</Label>
          <Select value={selectedPriceList} onValueChange={setSelectedPriceList}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {priceLists.map(pl => <SelectItem key={pl.id} value={pl.id}>{pl.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-primary">Category *</Label>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-primary">Privacy group</Label>
          <Select value={selectedPrivacyGroup || "__none__"} onValueChange={v => setSelectedPrivacyGroup(v === "__none__" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Choose privacy group" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Choose privacy group</SelectItem>
              {privacyGroups.map(pg => <SelectItem key={pg.id} value={pg.id}>{pg.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleExport} disabled={exporting} className="bg-primary">
          {exporting ? "Exporting..." : "Export"}
        </Button>
      </div>
    </AdminLayout>
  );
};

export default AdminProductExport;
