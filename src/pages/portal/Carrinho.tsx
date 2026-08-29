import { useNavigate } from "react-router-dom";
import PortalLayout from "@/components/layouts/PortalLayout";
import { useCart, cartKey } from "@/contexts/CartContext";
import { checkCartStock } from "@/lib/stock";
import { precoDoItem, clienteDoPortal, AVISO_PRECO_INCERTO } from "@/lib/precoDoItem";
import { fetchAllRows } from "@/lib/fetchAllRows";
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
  // Falhou a leitura da taxa? Entao o imposto na tela NAO e zero — e desconhecido.
  const [taxOk, setTaxOk] = useState(true);
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
  // Cliente ATUAL — durante "View as" e o impersonado. Serve so ao `moveToCart`,
  // que precisa do preco da tabela do cliente e nao do preco de balcao.
  //
  // TRI-ESTADO (`string | null | undefined`), e a regra inteira esta em
  // `clienteDoPortal`, com teste que roda — inclusive o valor INICIAL, que aqui
  // era um literal solto e podia ser trocado por `null` sem nenhum teste
  // reclamar. `null` e `undefined` nao sao a mesma coisa: um e "nao tem ficha,
  // preco base e o certo", o outro e "nao sei, o preco base e um chute".
  const [clienteId, setClienteId] = useState<string | null | undefined>(
    () => clienteDoPortal({ impersonatedId: impersonatedCustomer?.id, userId: user?.id }),
  );

  // Chave EFETIVA do "saved for later" — durante "View as" é a do cliente impersonado.
  const effectiveSavedKey = impersonatedCustomer?.id
    ? savedViewAsKey(impersonatedCustomer.id)
    : savedKey(user?.id);

  useEffect(() => {
    const contexto = { impersonatedId: impersonatedCustomer?.id, userId: user?.id };
    // Reavalia sem a leitura: "view as" resolve na hora, deslogado vira `null`
    // (senao um logout deixaria o aviso ligado para sempre), e o resto volta a
    // "nao sei" enquanto a consulta esta no ar.
    setClienteId(clienteDoPortal(contexto));
    if (impersonatedCustomer?.id || !user) return;

    let cancelado = false;
    supabase.from("clientes").select("id").eq("user_id", user.id).maybeSingle()
      .then((leitura) => {
        if (cancelado) return;
        // `error` LIDO: vira `undefined` (nao sei), e nao `null` (nao tem). O
        // aviso ao cliente sai no `moveToCart`, que e onde o preco aparece.
        if (leitura.error) console.error(leitura.error);
        setClienteId(clienteDoPortal({ ...contexto, leitura }));
      });
    return () => { cancelado = true; };
    // DEPS POR ID, e nao pelos objetos.
    //
    // `supabase-js` reemite `SIGNED_IN` a cada hidden->visible da aba
    // (`GoTrueClient._onVisibilityChanged` -> `_recoverAndRefresh`), e o
    // `AuthContext` grava `setUser(nextSession.user)` — objeto NOVO, mesmo id.
    // Com os objetos nas deps, trocar de aba e voltar rerodava este efeito, o
    // `setClienteId` de cima apagava o id ja resolvido, e um clique em MOVE TO
    // CART na janela do round-trip levava o produto pelo preco de balcao com o
    // aviso de "list price" — o defeito que esta leva fechou, reaberto a cada
    // volta para a aba. Verificado em React/jsdom: a sequencia era
    // `undefined -> cli-7 -> cli-7 -> undefined`.
    //
    // Por id, o efeito so reroda quando a identidade MUDA de verdade — e ai
    // apagar o valor antigo e o certo.
  }, [user?.id, impersonatedCustomer?.id]);

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

    // PRECO DA TABELA DO CLIENTE, e nao o preco de balcao.
    //
    // O preco salvo pode ter meses, entao ele e mesmo releito — mas relia
    // `produtos.preco`, o preco BASE. Quem tem tabela de preco ou preco
    // combinado via o item voltar do "saved for later" por um valor MAIOR do que
    // vai pagar: o servidor recalcula no fechamento
    // (`fn_pedido_item_preco_autoritativo`), entao nao cobrava errado — mostrava
    // errado, e o cliente desiste antes de chegar la. Os irmaos `Catalogo.tsx:469`
    // e `PedidoDetalhe.tsx:208` ja passavam pela cascata.
    //
    // Falha aqui NAO impede devolver ao carrinho: cai no preco base, que e o
    // comportamento de antes, e o cliente e avisado de que o valor exibido pode
    // nao ser o dele. O valor cobrado continua sendo o do servidor.
    const { preco, incerto } = await precoDoItem({
      produtoId: item.produto_id,
      clienteId,
      quantidade: item.quantidade ?? 1,
      precoBase: prod.preco ?? item.preco,
    });
    if (incerto) toast.warning(AVISO_PRECO_INCERTO);
    addItem({ ...item, preco });
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
        // PAGINADO: `.in(...)` sem `.range()` para em 1000 linhas com `error: null`.
        // Um carrinho de 25 produtos com grade de tamanho x cor chega la. E o
        // corte e pior que um erro: variante que ficou de fora vira "Out of
        // stock" numa linha que tem estoque, e produto cujas variantes TODAS
        // ficaram de fora deixa de acionar a guarda de linha-sem-variante — que
        // e a que impede a linha de viajar ate o pedido com o preco do pai.
        ids.length
          ? fetchAllRows<any>((f, t) => supabase.from("produto_variantes")
              .select("id, produto_id, quantidade, estoque_reservado")
              .eq("ativo", true).in("produto_id", ids)
              .order("id", { ascending: true }).range(f, t))
              .then((data) => ({ data }), (e) => ({ data: null as any[] | null, erro: e }))
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
    // FALHA DE LEITURA NAO E IMPOSTO ZERO.
    //
    // Os seis `await` desta cascata descartavam o `error` e caiam todos num
    // `setTaxRate(0)` indistinguivel de "este cliente nao paga imposto". E o caso
    // nao e hipotetico: `tax_rules` NAO tem unique em
    // (tax_class_id, tax_customer_group_id) e a tela de Sales Tax insere sem
    // checar — duas regras para o mesmo par fazem o `maybeSingle()` errar. A tela
    // mostrava "Sales Tax $0.00" e "Gross Total = subtotal" enquanto o banco, que
    // resolve com LIMIT 1, cobrava o imposto de verdade.
    //
    // Duas mudancas: `error` marca `taxOk = false` (a tela para de afirmar zero),
    // e a busca da regra usa `.limit(1)` para casar com o que o BANCO faz — assim
    // o cliente ve o mesmo numero que vai pagar, mesmo com regra duplicada.
    const fetchTaxRate = async () => {
      const semImposto = () => { setTaxRate(0); setTaxOk(true); };
      const naoSei = () => { setTaxRate(0); setTaxOk(false); };

      if (!user && !impersonatedCustomer) { semImposto(); return; }
      const clienteQuery = impersonatedCustomer?.id
        ? supabase.from("clientes").select("tax_customer_group_id").eq("id", impersonatedCustomer.id).maybeSingle()
        : supabase.from("clientes").select("tax_customer_group_id").eq("user_id", user!.id).maybeSingle();
      const { data: cliente, error: cliErr } = await clienteQuery;
      if (cliErr) { naoSei(); return; }
      if (!cliente) { semImposto(); return; }

      const groupId = cliente.tax_customer_group_id;
      const { data: defaultClass, error: clsErr } = await supabase
        .from("tax_classes").select("id").eq("is_default", true).maybeSingle();
      if (clsErr) { naoSei(); return; }
      if (!defaultClass?.id) { semImposto(); return; }

      let effectiveGroupId = groupId;
      if (!effectiveGroupId) {
        const { data: dg, error: dgErr } = await supabase
          .from("tax_customer_groups").select("id").eq("is_default", true).maybeSingle();
        if (dgErr) { naoSei(); return; }
        effectiveGroupId = dg?.id;
      }
      if (!effectiveGroupId) { semImposto(); return; }

      // `.limit(1)`: e o que o trigger do banco faz. Sem isso, regra duplicada
      // derruba a leitura inteira e a tela mostra zero.
      const { data: regras, error: ruleErr } = await supabase.from("tax_rules")
        .select("tax_rate_id")
        .eq("tax_class_id", defaultClass.id)
        .eq("tax_customer_group_id", effectiveGroupId)
        .limit(1);
      if (ruleErr) { naoSei(); return; }
      const taxRateId = regras?.[0]?.tax_rate_id;
      if (!taxRateId) { semImposto(); return; }

      const { data: rate, error: rateErr } = await supabase
        .from("tax_rates").select("percentual").eq("id", taxRateId).maybeSingle();
      if (rateErr) { naoSei(); return; }
      setTaxRate(Number(rate?.percentual) || 0);
      setTaxOk(true);
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
                        {...(insufficientItems.has(cartKey(item))
                          // Teto FRESCO, do watcher de 10s. `item.estoque_disponivel`
                          // e o numero congelado de quando o item entrou no carrinho:
                          // usa-lo aqui marcava o campo como invalido em item de
                          // pre-venda (disponivel 0) e travava em estoque antigo.
                          ? { max: insufficientItems.get(cartKey(item)) }
                          : {})}
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
                  <p className="font-bold">{taxOk ? `$${salesTax.toFixed(2)}` : "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Gross Total</p>
                  <p className="font-bold">{taxOk ? `$${grossTotal.toFixed(2)}` : "—"}</p>
                  {!taxOk && (
                    <p className="mt-1 text-xs text-destructive">
                      Sales tax could not be calculated — the final total will be shown at checkout.
                    </p>
                  )}
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
