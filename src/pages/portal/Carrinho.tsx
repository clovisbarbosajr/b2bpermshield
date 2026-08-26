import { useNavigate } from "react-router-dom";
import PortalLayout from "@/components/layouts/PortalLayout";
import { useCart, cartKey } from "@/contexts/CartContext";
import { checkCartStock } from "@/lib/stock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShoppingBag, X, Trash2, ChevronRight, Bookmark, RotateCcw, AlertTriangle } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

// Chave POR USUÁRIO (antes era global -> "saved for later" de um usuário aparecia
// pra outro no mesmo navegador). Espelha o padrão do carrinho (b2b_cart_<uid>).
// Durante "View as" a sessão real é a do ADMIN: sem a chave por cliente impersonado,
// a lista era compartilhada entre TODOS os clientes vistos e se misturava com a do
// próprio admin (mesmo problema já resolvido no CartContext).
const savedKey = (uid?: string | null) => uid ? `cart_saved_for_later_${uid}` : "cart_saved_for_later_anon";
const savedViewAsKey = (customerId: string) => `cart_saved_for_later_viewas_${customerId}`;

const Carrinho = () => {
  const { items, removeItem, updateQuantity, clearCart, total, addItem } = useCart();
  const { user, canPlaceOrders, impersonatedCustomer } = useAuth();
  const navigate = useNavigate();
  const [salesTax, setSalesTax] = useState(0);
  // Taxa (%) buscada 1x; o VALOR do imposto é derivado de total × taxa (efeito abaixo).
  const [taxRate, setTaxRate] = useState(0);
  // Chaveados por `cartKey` (produto+variante), não por produto: com duas
  // variantes do mesmo produto no carrinho, chavear por produto_id marcava as
  // DUAS linhas quando só uma estava sem estoque.
  const [unavailableItems, setUnavailableItems] = useState<Map<string, any>>(new Map());
  // Itens COM algum estoque, mas menos que a quantidade pedida (quer 5, tem 3).
  // Bloqueiam finalizar, mas a quantidade pode ser reduzida (input fica habilitado).
  const [insufficientItems, setInsufficientItems] = useState<Map<string, number>>(new Map());
  const [savedItems, setSavedItems] = useState<any[]>([]);

  // Chave EFETIVA do "saved for later" — durante "View as" é a do cliente impersonado.
  const effectiveSavedKey = impersonatedCustomer?.id
    ? savedViewAsKey(impersonatedCustomer.id)
    : savedKey(user?.id);

  // Carrega "saved for later" do usuário atual e limpa a chave global legada (que vazava).
  useEffect(() => {
    try {
      setSavedItems(JSON.parse(localStorage.getItem(effectiveSavedKey) ?? "[]"));
    } catch { setSavedItems([]); }
    localStorage.removeItem("cart_saved_for_later"); // remove dados vazados da chave antiga
  }, [effectiveSavedKey]);

  // Aceita lista OU funcao. A forma funcional le o estado ATUAL: sem ela, dois
  // cliques rapidos em itens diferentes liam a mesma lista e o segundo regravava
  // o primeiro de volta.
  const persistSaved = (updated: any[] | ((atual: any[]) => any[])) => {
    setSavedItems((atual: any[]) => {
      const novo = typeof updated === "function" ? (updated as (a: any[]) => any[])(atual) : updated;
      localStorage.setItem(effectiveSavedKey, JSON.stringify(novo));
      return novo;
    });
  };

  // Identidade do item salvo = produto + variante (cartKey). Filtrar só por
  // produto_id APAGAVA a outra variante: salvar "Camiseta M" e depois "Camiseta G"
  // descartava a M silenciosamente (ela já tinha saído do carrinho).
  const saveForLater = (item: any) => {
    removeItem(cartKey(item));
    persistSaved([...savedItems.filter((s) => cartKey(s) !== cartKey(item)), item]);
    toast.info(`${item.nome} saved for later`);
  };

  // REVALIDA antes de devolver ao carrinho. O "saved for later" e persistente:
  // o objeto vem cru do localStorage, com o preco e o estoque do dia em que foi
  // salvo, e ignorava todas as guardas de variante. Item salvo antes do produto
  // ganhar variante voltava sem variante e com o preco do pai.
  const moveToCart = async (item: any) => {
    // Trava de clique: virou async (duas idas ao banco), entao o botao fica mudo
    // por centenas de ms e o duplo clique ficou MAIS provavel. `addItem` SOMA
    // quando a chave ja existe — quantidade dobrada, calada. Mesmo padrao do
    // `addingRef` do catalogo.
    if (movendoRef.current.has(cartKey(item))) return;
    movendoRef.current.add(cartKey(item));
    try {
    const { data: prod, error: prodErr } = await supabase
      .from("produtos").select("id, preco, ativo")
      .eq("id", item.produto_id).maybeSingle();
    if (prodErr) { console.error(prodErr); toast.error("Could not check this product. Please try again."); return; }
    if (!prod || prod.ativo === false) { toast.error(`${item.nome} is no longer available.`); return; }

    if (item.variante_id) {
      // Variante EXISTENTE tambem precisa ser revalidada: a versao anterior so
      // olhava quando a linha NAO tinha variante, entao variante apagada ou
      // desativada voltava para o carrinho.
      const { data: v, error: vErr } = await supabase
        .from("produto_variantes").select("id, ativo")
        .eq("id", item.variante_id).maybeSingle();
      if (vErr) { console.error(vErr); toast.error("Could not check product options. Please try again."); return; }
      if (!v || v.ativo === false) { toast.error("That option is no longer available."); return; }
    }

    if (!item.variante_id) {
      const { data: temVar, error: varErr } = await supabase
        .from("produto_variantes").select("id")
        .eq("produto_id", item.produto_id).eq("ativo", true).limit(1);
      if (varErr) { console.error(varErr); toast.error("Could not check product options. Please try again."); return; }
      if ((temVar ?? []).length > 0) {
        toast.error("This product now has options — please pick one on the product page.");
        return;
      }
    }

    // Preco releito do banco: o salvo pode ter meses. E o preco BASE — o
    // definitivo e recalculado no submit (`getProductPrice`), como no re-order.
    addItem({ ...item, preco: prod.preco ?? item.preco });
    // Filtra a partir do estado ATUAL, nao do capturado na closure. Clicando em
    // dois itens rapido, os dois liam a mesma lista e o segundo regravava o
    // primeiro DE VOLTA — item no carrinho e em "saved for later" ao mesmo
    // tempo, e o proximo clique somava a quantidade.
    persistSaved((atual) => atual.filter((s: any) => cartKey(s) !== cartKey(item)));
    toast.success(`${item.nome} moved to cart`);
    } finally {
      movendoRef.current.delete(cartKey(item));
    }
  };

  // Chaves em movimento — evita o duplo clique somar duas vezes.
  const movendoRef = useRef(new Set<string>());

  const removeSaved = (key: string) => {
    persistSaved(savedItems.filter((s) => cartKey(s) !== key));
  };

  // Disponibilidade em TEMPO REAL — não pode ter risco de comprar com estoque
  // faltando. Re-checa: ao mudar o carrinho, a cada 10s (polling), ao VOLTAR pra
  // aba, e via Supabase Realtime (mudança de estoque dos produtos do carrinho).
  // O guard FINAL é o trigger de reserva no banco (rejeita no submit), isto é a
  // camada de aviso pra bloquear ANTES.
  useEffect(() => {
    if (items.length === 0) { setUnavailableItems(new Map()); setInsufficientItems(new Map()); return; }
    const ids = items.map(i => i.produto_id);
    let cancelled = false;

    const check = async () => {
      // As variantes do carrinho entram na conta: o estoque por variante existe
      // (`produto_variantes.quantidade`) e antes só a página do produto olhava —
      // dava pra entrar por lá e depois furar mudando a quantidade AQUI.
      const [{ data: prods }, { data: statuses }, { data: vars }] = await Promise.all([
        supabase.from("produtos").select("id, estoque_total, estoque_reservado, status_produto").in("id", ids),
        supabase.from("product_statuses").select("nome, permite_comprar"),
        // `ids.length`, NAO `varIds.length`: pular quando nenhuma linha tem
        // variante e exatamente perder o caso que interessa — produto que ganhou
        // opcao DEPOIS que o cliente o colocou no carrinho.
        ids.length
          ? supabase.from("produto_variantes").select("id, produto_id, quantidade, estoque_reservado").eq("ativo", true).in("produto_id", ids)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      // Cobre `vars` tambem: sem isso, falha na consulta de variantes deixava a
      // checagem rodar com lista vazia — ou seja, sem a regra de variante.
      if (cancelled || !prods || !statuses || !vars) return;
      // Regra única, compartilhada com o Checkout e coberta por teste (src/lib/stock.test.ts).
      const { blocked, insufficient } = checkCartStock(items, prods, statuses, vars ?? []);
      setUnavailableItems(blocked);
      setInsufficientItems(insufficient);
    };

    check();
    const interval = setInterval(check, 10000);
    const onFocus = () => { if (document.visibilityState !== "hidden") check(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    // Nome ÚNICO por execução do efeito. Com `cart-stock-${ids.length}` o topic se
    // repetia (mesma qtd de itens, ou carrinho + checkout abertos), e o unsubscribe
    // do efeito antigo podia derrubar o canal novo — o carrinho parava de receber
    // mudança de estoque em tempo real e só o polling de 10s salvava.
    const channel = supabase
      .channel(`cart-stock-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "produtos", filter: `id=in.(${ids.join(",")})` }, () => check())
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      supabase.removeChannel(channel);
    };
  }, [items]);

  // Busca a TAXA (%) uma vez por usuário. Antes esse efeito dependia de `total`
  // e refazia a cascata inteira (até 5 queries) A CADA clique de quantidade —
  // mesma classe da lentidão corrigida no Checkout. O VALOR do imposto é
  // derivado no efeito [total, taxRate] logo abaixo, sem ir ao banco.
  useEffect(() => {
    const fetchTaxRate = async () => {
      if (!user && !impersonatedCustomer) { setTaxRate(0); return; }
      // Get customer's tax group
      const clienteQuery = impersonatedCustomer?.id
        ? supabase.from("clientes").select("tax_customer_group_id").eq("id", impersonatedCustomer.id).maybeSingle()
        : supabase.from("clientes").select("tax_customer_group_id").eq("user_id", user!.id).maybeSingle();
      const { data: cliente } = await clienteQuery;
      if (!cliente) { setTaxRate(0); return; }

      const groupId = cliente.tax_customer_group_id;
      const { data: defaultClass } = await supabase.from("tax_classes").select("id").eq("is_default", true).maybeSingle();
      if (!defaultClass?.id) { setTaxRate(0); return; }

      // Resolve group: use customer's group or default group
      let effectiveGroupId = groupId;
      if (!effectiveGroupId) {
        const { data: dg } = await supabase.from("tax_customer_groups").select("id").eq("is_default", true).maybeSingle();
        effectiveGroupId = dg?.id;
      }
      if (!effectiveGroupId) { setTaxRate(0); return; }

      const { data: rule } = await supabase.from("tax_rules")
        .select("tax_rate_id")
        .eq("tax_class_id", defaultClass.id)
        .eq("tax_customer_group_id", effectiveGroupId)
        .maybeSingle();
      if (!rule?.tax_rate_id) { setTaxRate(0); return; }

      const { data: rate } = await supabase.from("tax_rates").select("percentual").eq("id", rule.tax_rate_id).maybeSingle();
      setTaxRate(Number(rate?.percentual) || 0);
    };
    fetchTaxRate();
  }, [user, impersonatedCustomer]);

  // Valor do imposto derivado localmente — reage ao carrinho sem tocar o banco.
  useEffect(() => {
    setSalesTax(total * taxRate / 100);
  }, [total, taxRate]);

  const totalQuantity = items.reduce((sum, i) => sum + i.quantidade, 0);
  const grossTotal = total + salesTax;

  return (
    <PortalLayout>
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
        <button onClick={() => navigate("/portal/catalogo")} className="hover:text-primary">Home</button>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">Current order</span>
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">Current Order</h2>
          {items.length > 0 && (
            <Button variant="ghost" className="text-destructive gap-2" onClick={clearCart}>
              DELETE ALL <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center py-12">
            <ShoppingBag className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-muted-foreground">Your order is empty.</p>
            <Button className="mt-4" onClick={() => navigate("/portal/catalogo")}>Browse Catalog</Button>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">CODE ▲</TableHead>
                  <TableHead>PRODUCT</TableHead>
                  <TableHead className="w-24">PRICE</TableHead>
                  <TableHead className="w-28">QUANTITY</TableHead>
                  <TableHead className="w-24">DISCOUNT</TableHead>
                  <TableHead className="w-24">TOTAL</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(item => (
                  // key por produto+variante: com `produto_id` duas variantes do mesmo
                  // produto geravam chaves DUPLICADAS e o React embaralhava as linhas.
                  <TableRow key={cartKey(item)}>
                    <TableCell>
                      <div className="h-10 w-10 bg-muted rounded overflow-hidden">
                        {item.imagem_url ? (
                          <img src={item.imagem_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                            {item.nome.charAt(0)}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      {item.nome}
                      {item.variante_label && (
                        <span className="block text-xs text-muted-foreground font-normal">{item.variante_label}</span>
                      )}
                      {unavailableItems.has(cartKey(item)) && (
                        <Badge variant="destructive" className="ml-2 text-xs">Out of stock</Badge>
                      )}
                      {insufficientItems.has(cartKey(item)) && (
                        <Badge variant="destructive" className="ml-2 text-xs">
                          Only {insufficientItems.get(cartKey(item))} left — reduce qty
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>${Number(item.preco).toFixed(2)}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={item.quantidade_minima}
                        max={item.estoque_disponivel}
                        value={item.quantidade}
                        onChange={e => updateQuantity(cartKey(item), parseInt(e.target.value) || item.quantidade_minima)}
                        className="h-8 w-20"
                        disabled={unavailableItems.has(cartKey(item))}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">-</TableCell>
                    <TableCell className="font-medium">${(item.preco * item.quantidade).toFixed(2)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <button
                          onClick={() => saveForLater(item)}
                          title="Save for later"
                          className="h-7 w-7 rounded-full border border-primary/40 text-primary flex items-center justify-center hover:bg-primary/10 transition-colors"
                        >
                          <Bookmark className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => removeItem(cartKey(item))}
                          className="h-7 w-7 rounded-full border border-destructive text-destructive flex items-center justify-center hover:bg-destructive hover:text-white transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Summary */}
            <div className="mt-4 flex items-center justify-between">
              <Card className="p-4 inline-flex gap-6">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Total Quantity</p>
                  <p className="font-bold">{totalQuantity}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Total</p>
                  <p className="font-bold">${total.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Sales Tax</p>
                  <p className="font-bold">${salesTax.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Gross Total</p>
                  <p className="font-bold">${grossTotal.toFixed(2)}</p>
                </div>
              </Card>

              <div className="flex flex-col items-end gap-2">
                {unavailableItems.size > 0 && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" /> Remove out-of-stock items to proceed
                  </p>
                )}
                {insufficientItems.size > 0 && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" /> Reduce quantities to the available stock to proceed
                  </p>
                )}
                {!canPlaceOrders ? (
                  <p className="text-sm text-muted-foreground italic">Your account needs approval to place orders — ordering disabled</p>
                ) : (
                  <Button onClick={() => navigate("/portal/checkout")} disabled={unavailableItems.size > 0 || insufficientItems.size > 0}>NEXT</Button>
                )}
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Saved for Later */}
      {savedItems.length > 0 && (
        <Card className="mt-6 p-6">
          <h3 className="text-lg font-bold mb-4">Saved for Later ({savedItems.length})</h3>
          <div className="divide-y">
            {savedItems.map((item) => (
              <div key={cartKey(item)} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded bg-muted overflow-hidden flex-shrink-0">
                    {item.imagem_url ? (
                      <img src={item.imagem_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                        {item.nome?.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{item.nome}</p>
                    <p className="text-xs text-muted-foreground">${Number(item.preco).toFixed(2)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => moveToCart(item)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Move to Cart
                  </Button>
                  <button
                    onClick={() => removeSaved(cartKey(item))}
                    className="h-7 w-7 rounded-full border border-destructive text-destructive flex items-center justify-center hover:bg-destructive hover:text-white transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </PortalLayout>
  );
};

export default Carrinho;
