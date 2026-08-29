import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import PortalLayout from "@/components/layouts/PortalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { statusLabel, statusBadge } from "@/lib/orderStatuses";
import { formatOpcao } from "@/lib/variants";
import { precoDoItem, AVISO_PRECO_INCERTO } from "@/lib/precoDoItem";
// Uma definicao so para as tres telas do historico — ver `Pedidos.tsx`.
import { escoparPelaRls } from "./Pedidos";

const PedidoDetalhe = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, role, impersonatedCustomer } = useAuth();
  const { addItem } = useCart();
  const [pedido, setPedido] = useState<any>(null);
  const [itens, setItens] = useState<any[]>([]);
  const [endereco, setEndereco] = useState<any>(null);
  const [cliente, setCliente] = useState<any>(null);
  const [shippingOption, setShippingOption] = useState<any>(null);
  const [paymentOption, setPaymentOption] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fmtDate = (d: string) => {
    if (!d) return "-";
    const dt = new Date(d);
    return `${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}/${dt.getFullYear()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
  };
  const fmtDateShort = (d: string) => {
    if (!d) return "-";
    const dt = new Date(d);
    return `${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}/${dt.getFullYear()}`;
  };

  useEffect(() => {
    if (!id) return;
    const fetch = async () => {
      setLoading(true);

      // Load cliente
      // COLUNAS EXPLICITAS, e nao `*`.
      //
      // RLS filtra LINHA, nao COLUNA: `select("*")` em `clientes` entregava ao
      // navegador do proprio cliente o `admin_comments` ("anotacao interna do
      // admin SOBRE o cliente", 20260826020000:25), mais `discount`,
      // `minimum_order_value`, `representante_id` e `tabela_preco_id`. Nada disso
      // e renderizado — chega inteiro pela aba Network. Mesma classe do `custo` de
      // produto e do `gateway_config`, ja fechados em outros pontos.
      const clienteQuery = impersonatedCustomer?.id
        ? supabase.from("clientes").select("id, user_id, nome, email, telefone, empresa, endereco, cidade, cep, estado, pais, can_view_full_history, can_confirm_order, status, is_active").eq("id", impersonatedCustomer.id).maybeSingle()
        : supabase.from("clientes").select("id, user_id, nome, email, telefone, empresa, endereco, cidade, cep, estado, pais, can_view_full_history, can_confirm_order, status, is_active").eq("user_id", user!.id).maybeSingle();
      const { data: clienteData, error: clienteErr } = await clienteQuery;
      if (clienteErr) {
        console.error(clienteErr);
        toast.error("Could not load your account. Please try again.");
        navigate("/portal/pedidos");
        return;
      }
      setCliente(clienteData);

      // Quem pode LER este pedido e a RLS que decide. `Sub-customer reads parent
      // history` e `Parent reads sub-customer orders` ja entregam o pedido do pai
      // e o do funcionario; comparar `p.cliente_id` com a MINHA ficha derrubava
      // exatamente esses dois casos, e ainda se desligava sozinha quando
      // `clienteData` vinha nulo (`clienteData &&` na guarda antiga).
      // `admin_notes` FICA DE FORA: 20260825240000:127 o define como campo de
      // staff, e o proprio admin ve o placeholder "Not shown to the customer" ao
      // preenche-lo (`admin/OrderDetail.tsx:1069`). Com `select("*")` ele viajava
      // para o navegador do cliente — o sistema prometia uma coisa ao admin e
      // entregava outra.
      const { data: p, error: pedidoErr } = await supabase.from("pedidos")
        .select("id, numero, cliente_id, status, subtotal, total, sales_tax, shipping_costs, desconto, po_number, observacoes, tracking_number, delivery_date, created_at, updated_at, endereco_entrega_id, shipping_option_id, payment_option_id")
        .eq("id", id).maybeSingle();
      // Falha de rede virava "Order not found" — dizia que o pedido nao existe
      // sem saber disso.
      if (pedidoErr) {
        console.error(pedidoErr);
        toast.error("Could not load the order. Please try again.");
        navigate("/portal/pedidos");
        return;
      }
      // FORA da conta de cliente comum a comparacao continua sendo a unica cerca:
      // staff (admin/manager/warehouse) le TODOS os pedidos, e `/portal/pedidos/:id`
      // nao exige papel nenhum em App.tsx. Falha fechado — papel desconhecido, ou
      // ficha do cliente ausente, dao `""`, que nao casa com nenhum `cliente_id`.
      const donoEsperado = impersonatedCustomer?.id ?? clienteData?.id ?? "";
      if (!p || (!escoparPelaRls(role, impersonatedCustomer?.id) && p.cliente_id !== donoEsperado)) {
        toast.error("Order not found");
        navigate("/portal/pedidos");
        return;
      }
      setPedido(p);

      // Load items, address, shipping, payment in parallel
      const [
        { data: items, error: itensErr },
        { data: addr, error: addrErr },
        { data: ship, error: shipErr },
        { data: pay, error: payErr },
      ] = await Promise.all([
        supabase.from("pedido_itens").select("*").eq("pedido_id", id),
        p.endereco_entrega_id
          ? supabase.from("enderecos").select("*").eq("id", p.endereco_entrega_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        p.shipping_option_id
          ? supabase.from("shipping_options").select("nome").eq("id", p.shipping_option_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        p.payment_option_id
          ? supabase.from("payment_options").select("nome").eq("id", p.payment_option_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      // OS QUATRO `error` SAO LIDOS. Falha na leitura dos itens deixava a tela
      // renderizar o pedido com a tabela de produtos VAZIA e o rodape mostrando
      // Total e Gross Total — o cliente via um pedido de milhares de reais sem
      // nenhum item. E o `handleExport` monta o CSV a partir deste mesmo estado,
      // entao o arquivo saia com cabecalho, zero produtos e a linha de total, com
      // download aparentemente bem-sucedido.
      //
      // O proprio arquivo ja checava `error` duas vezes acima, com a justificativa
      // escrita — estas quatro ficaram de fora.
      if (itensErr) {
        // SAI DA TELA. So o `return` nao bastava: `setPedido(p)` ja rodou acima e
        // o unico guarda do render e `if (!pedido) return null`, entao a pagina
        // aparecia inteira com a tabela de produtos VAZIA e o rodape mostrando
        // "Total $4.812,00" — e o EXPORT baixava um CSV com cabecalho, zero
        // produtos e a linha de total. Mesma saida dos dois erros de leitura
        // logo acima, no mesmo `fetch`.
        //
        // Nao pega pedido legitimamente sem itens: RLS filtrando devolve
        // `data: []` com `error: null`.
        console.error(itensErr);
        toast.error("Could not load the items of this order. Please try again.");
        navigate("/portal/pedidos");
        return;
      }
      if (addrErr || shipErr || payErr) {
        // Estes tres sao complementares: sem eles a tela ainda diz a verdade
        // sobre o pedido, mas nao pode fingir que o campo esta vazio.
        console.error(addrErr ?? shipErr ?? payErr);
        toast.warning("Some delivery details could not be loaded.");
      }
      setItens(items ?? []);
      setEndereco(addr);
      setShippingOption(ship);
      setPaymentOption(pay);
      setLoading(false);
    };
    fetch();
  }, [id, user, role, impersonatedCustomer]);

  // Linhas em voo — o ADD TO ORDER virou mais lento nesta leva (o
  // `getProductPrice` acrescentou 2-3 idas ao banco EM SERIE ao `Promise.all`
  // que ja existia), entao o botao fica mudo por mais tempo e o duplo clique
  // ficou mais provavel. `addItem` SOMA quando a chave ja existe
  // (`CartContext.tsx:220`): a linha de 10 unidades virava 20, calada, com dois
  // `toast.success` normais. Mesma trava do `movendoRef` do `Carrinho`.
  //
  // LISTA, e nao um id so. Com escalar, clicar em A e depois em B fazia
  // `setAdicionando(B.id)` apagar o A: o botao de A nunca chegava a desabilitar,
  // e quando a resposta de A chegava o `finally` zerava o escalar e o botao de B
  // voltava a parecer clicavel com B ainda em voo — clicavel e inerte, porque o
  // `Set` (que e a trava de verdade) continuava barrando. Nenhum dado errado; um
  // botao que mente sobre o proprio estado.
  const adicionandoRef = useRef(new Set<string>());
  const [adicionando, setAdicionando] = useState<string[]>([]);

  const handleAddToOrder = async (item: any) => {
    if (adicionandoRef.current.has(item.id)) return;
    adicionandoRef.current.add(item.id);
    setAdicionando((atual) => [...atual, item.id]);
    try {
    // Mesma regra do re-order da lista: a variante vem de `pedido_itens.variante_id`.
    // Sem ela, repetir a linha mandava o produto-pai (tamanho/cor errados).
    const [{ data: prod }, { data: v }] = await Promise.all([
      supabase.from("produtos")
        .select("id, preco, estoque_total, estoque_reservado, quantidade_minima, unidade_venda, imagem_url")
        .eq("id", item.produto_id).maybeSingle(),
      item.variante_id
        ? supabase.from("produto_variantes")
            // `estoque_reservado` JUNTO: o banco decide por
            // `(quantidade - estoque_reservado)` (20260825320000:136). Sem a
            // coluna, uma variante com tudo preso em pedido aberto aparecia como
            // disponivel, o cliente adicionava, e o carrinho ou o checkout
            // recusava depois. O irmao `Pedidos.tsx:196` ja lia certo.
            .select("id, codigo, quantidade, estoque_reservado, imagem_url, valores_opcao, ativo")
            .eq("id", item.variante_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);
    if (!prod) { toast.error("Product not available"); return; }
    if (item.variante_id && (!v || v.ativo === false)) {
      toast.error("That option is no longer available.");
      return;
    }
    // Pedido IMPORTADO do B2BWave nao guarda `variante_id`. Se o produto tem
    // variante hoje, repetir a linha "sem variante" manda o produto-pai, com o
    // preco do pai. Este e o caminho mais natural para repetir um pedido
    // importado — e era o unico sem a guarda. 1 produto por clique, entao uma
    // consulta simples resolve.
    if (!item.variante_id) {
      const { data: temVar, error: varErr } = await supabase
        .from("produto_variantes").select("id")
        .eq("produto_id", item.produto_id).eq("ativo", true).limit(1);
      // Falha NAO pode virar "nao tem variante": seria o pedido errado.
      if (varErr) { console.error(varErr); toast.error("Could not check product options. Please try again."); return; }
      if ((temVar ?? []).length > 0) {
        toast.error("This product now has options — please pick one on the product page.");
        return;
      }
    }
    const dispProduto = (prod.estoque_total ?? 0) - (prod.estoque_reservado ?? 0);
    const dispVariante = v ? (v.quantidade ?? 0) - ((v as any).estoque_reservado ?? 0) : 0;
    const disponivel = v ? Math.min(dispProduto, dispVariante) : dispProduto;

    // PRECO DA TABELA DO CLIENTE, e nao o preco de balcao. A decisao inteira
    // (cascata, fallback, tri-estado do cliente e quando avisar) esta em
    // `lib/precoDoItem.ts`, com teste que roda.
    //
    // O id e o do PROPRIO cliente. Resolver o `parent_customer_id` aqui matava a
    // tabela de preco do sub-login — `pricing.ts` ja resolve o pai sozinho, e a
    // precedencia e `tabela do sub ?? tabela da empresa`.
    const clienteId = cliente?.id ?? null;
    const { preco, incerto } = await precoDoItem({
      produtoId: item.produto_id,
      clienteId,
      quantidade: item.quantidade,
      precoBase: prod.preco ?? item.preco_unitario,
    });
    if (incerto) toast.warning(AVISO_PRECO_INCERTO);

    addItem({
      produto_id: item.produto_id,
      variante_id: item.variante_id ?? null,
      variante_label: v ? formatOpcao(v.valores_opcao) || v.codigo : null,
      nome: item.nome_produto,
      sku: v?.codigo || item.sku || "",
      preco,
      quantidade: Math.min(item.quantidade, Math.max(disponivel, 1)),
      unidade_venda: prod.unidade_venda ?? "UN",
      quantidade_minima: prod.quantidade_minima ?? 1,
      estoque_disponivel: disponivel,   // estoque REAL (antes era Math.max(...,99) -> oversell)
      imagem_url: v?.imagem_url || prod.imagem_url || null,
    });
    toast.success(`${item.nome_produto} added to cart`);
    } finally {
      adicionandoRef.current.delete(item.id);
      setAdicionando((atual) => atual.filter((x) => x !== item.id));
    }
  };

  const handleExport = () => {
    if (!pedido) return;
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Order", "SKU", "Product", "Quantity", "Unit Price", "Subtotal"],
      ...itens.map((it) => [
        pedido.numero, it.sku, it.nome_produto, it.quantidade,
        Number(it.preco_unitario).toFixed(2), Number(it.subtotal).toFixed(2),
      ]),
      [], ["", "", "", "", "Total", Number(pedido.total ?? 0).toFixed(2)],
    ];
    const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `order-${pedido.numero}.csv`;
    a.click();
  };

  const Field = ({ label, value }: { label: string; value?: string | null }) => (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <Input value={value ?? ""} readOnly className="bg-muted/30 text-sm h-8" />
    </div>
  );

  if (loading) return (
    <PortalLayout>
      <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
    </PortalLayout>
  );

  if (!pedido) return null;

  // "Sem imposto" NAO e "isento".
  //
  // `hasTax` derivava uma afirmacao sobre a situacao FISCAL do cliente de um
  // valor que da zero por varios motivos: nao ha regra em `tax_rules` para o par
  // (grupo do cliente, classe do produto), o pedido veio importado do B2BWave sem
  // o campo, ou o cupom zerou. Nao existe flag de isencao em `clientes` nem em
  // `tax_customer_groups` — o sistema nao guarda esse dado, entao a tela nao pode
  // afirma-lo. `Carrinho.tsx:399` ja se recusa a afirmar imposto que nao
  // conseguiu calcular.
  const salesTax = Number(pedido.sales_tax ?? 0);
  const hasTax = salesTax > 0;

  // O bloco de endereco caia para o cadastro de QUEM ESTA OLHANDO quando o
  // pedido nao trazia `endereco_entrega_id` (pedido importado do B2BWave, por
  // exemplo). Enquanto esta tela so abria o pedido do proprio cliente isso era um
  // palpite plausivel. Agora que o pai abre o pedido do funcionario — e o
  // sub-usuario com `can_view_full_history` abre o do pai — o mesmo palpite
  // carimbaria o endereco, o telefone e o e-mail do LEITOR no pedido do outro.
  // Fora do pedido proprio, so o que veio do pedido.
  const perfil = cliente && pedido.cliente_id === cliente.id ? cliente : null;

  return (
    <PortalLayout>
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground border-b pb-3">
        <button onClick={() => navigate("/portal")} className="hover:text-primary">Home</button>
        <span>|</span>
        <span className="text-foreground font-medium">Order #{pedido.numero}</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Order #{pedido.numero}</h2>
        <Button variant="outline" size="sm" className="gap-1" onClick={handleExport}>
          <Download className="h-4 w-4" /> EXPORT
        </Button>
      </div>

      <div className="space-y-6">
        {/* Address section */}
        <div className="bg-card rounded-lg border p-5">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Address" value={endereco?.logradouro ?? perfil?.endereco} />
            <Field label="City" value={endereco?.cidade ?? perfil?.cidade} />
            <Field label="Phone" value={perfil?.telefone} />
            <Field label="Address 2" value={endereco?.complemento} />
            <Field label="Email" value={perfil?.email} />
            <Field label="Last Update" value={fmtDate(pedido.updated_at ?? pedido.created_at)} />
            <Field label="Postal Code" value={endereco?.cep ?? perfil?.cep} />
            {/* `clientes.pais` existe e o sync do B2BWave grava o valor real
                (`b2bwave-sync:1932`), entao pedido de cliente canadense exibia
                "US". Fica em branco no pedido de terceiro, como Phone e Email —
                `perfil` e null quando o pedido nao e da ficha carregada. */}
            <Field label="Country" value={perfil?.pais} />
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Sales Tax</p>
              <Input
                value={hasTax ? "Sales Tax applies" : "No sales tax on this order"}
                readOnly
                className="bg-muted/30 text-sm h-8"
              />
            </div>
          </div>
        </div>

        {/* Information section */}
        <div className="bg-card rounded-lg border p-5">
          <h3 className="text-lg font-bold mb-4">Information</h3>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Purchase Order" value={pedido.po_number} />
            <div className="col-span-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Comments for your order</p>
              <Input value={pedido.observacoes ?? ""} readOnly className="bg-muted/30 text-sm h-8" />
            </div>
            <div />
            <div />
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Status</p>
              <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold border ${statusBadge(pedido.status)}`}>
                {statusLabel(pedido.status).toUpperCase()}
              </span>
            </div>
            <Field label="Payment Option" value={paymentOption?.nome} />
            <Field label="Shipping Option" value={shippingOption?.nome} />
            <Field label="Shipping Costs" value={`$${Number(pedido.shipping_costs ?? 0).toFixed(2)}`} />
            <Field label="Tracking Number" value={pedido.tracking_number} />
          </div>
        </div>

        {/* Customer Information section */}
        <div className="bg-card rounded-lg border p-5">
          <h3 className="text-lg font-bold mb-4">Customer Information</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Comments for your order</p>
              <Input value={pedido.observacoes ?? ""} readOnly className="bg-muted/30 text-sm h-8" />
            </div>
            <Field label="Delivery Date" value={fmtDateShort(pedido.delivery_date ?? "")} />
          </div>
        </div>

        {/* Products table */}
        <div className="bg-card rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b border-border">
              <tr>
                <th className="px-4 py-3 w-12" />
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Code</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Product</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Price</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Quantity</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Discount</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Total</th>
                <th className="px-4 py-3 w-28" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {itens.map(item => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <div className="h-10 w-10 rounded bg-muted overflow-hidden">
                      <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                        {item.nome_produto?.charAt(0)}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{item.sku}</td>
                  <td className="px-4 py-3 font-medium">{item.nome_produto}</td>
                  <td className="px-4 py-3">${Number(item.preco_unitario).toFixed(2)}</td>
                  <td className="px-4 py-3">{item.quantidade}</td>
                  <td className="px-4 py-3 text-muted-foreground">-</td>
                  <td className="px-4 py-3 text-right font-medium">${Number(item.subtotal).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-slate-700 hover:bg-slate-600 text-white"
                      onClick={() => handleAddToOrder(item)}
                      disabled={adicionando.includes(item.id)}
                    >
                      ADD TO ORDER
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals footer */}
          <div className="flex justify-end gap-8 px-6 py-4 border-t border-border bg-muted/20">
            <div className="text-right">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Total</p>
              <p className="text-base font-bold">${Number(pedido.subtotal ?? 0).toFixed(2)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Gross Total</p>
              <p className="text-base font-bold text-primary">${Number(pedido.total ?? 0).toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/portal/pedidos")}>← Back to Orders</Button>
        </div>
      </div>
    </PortalLayout>
  );
};

export default PedidoDetalhe;
