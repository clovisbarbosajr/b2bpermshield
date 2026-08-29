import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type CartItem = {
  produto_id: string;
  variante_id?: string | null;     // variante escolhida (Size/Color), se o produto tiver
  variante_label?: string | null;  // ex.: "Size: M / Color: Blue" (exibição)
  nome: string;
  sku: string;
  preco: number;
  quantidade: number;
  unidade_venda: string;
  quantidade_minima: number;
  estoque_disponivel: number;
  imagem_url?: string | null;
};

// Identidade de uma linha do carrinho = produto + variante. A definição mora em
// "@/lib/stock" (módulo puro, sem arrastar o cliente Supabase junto).
//
// PRECISA ser `import` + `export`, NÃO `export { cartKey } from "..."`.
// O re-export repassa o símbolo pra quem importa este módulo, mas **não cria
// binding local** — é regra da spec ESM. Com o re-export, o `cartKey` usado aqui
// dentro (addItem/removeItem/updateQuantity) virava um global inexistente e
// `addItem` lançava `ReferenceError: cartKey is not defined` a CADA clique em
// "Add to order". Como `handleAdd` é async, virava unhandled rejection: o botão
// não fazia nada, sem erro na tela, e o toast de sucesso (que vem depois) nunca
// aparecia. O carrinho ficou quebrado pra TODO MUNDO, não só no "View as".
import { cartKey } from "@/lib/stock";
export { cartKey };

interface CartContextType {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (key: string) => void;       // key = cartKey(item)
  updateQuantity: (key: string, quantidade: number) => void;
  updatePrice: (key: string, preco: number, quantidadeEsperada?: number) => void;
  clearCart: () => void;
  total: number;
}

const storageKey = (userId: string) => `b2b_cart_${userId}`;
// Durante "View as", a sessão REAL é a do admin — sem uma chave própria por cliente
// impersonado, TODOS os clientes vistos pelo admin dividiam o mesmo carrinho
// (`b2b_cart_<admin_uid>`). Com view-as por aba isso é pior: duas abas com clientes
// diferentes gravavam uma por cima da outra, dando pra enviar o pedido do cliente A
// no nome do B.
const viewAsStorageKey = (customerId: string) => `b2b_cart_viewas_${customerId}`;
const ANON_KEY = "b2b_cart_anon";

// No logout, o carrinho PESSOAL (`b2b_cart_<uid>`) fica de propósito — o cliente
// espera reencontrar os itens ao voltar. Já os carrinhos de "View as" são rascunho
// da sessão do admin: se ficarem no localStorage, sobrevivem à saída dele e ainda
// aparecem pro próximo admin que entrar naquela máquina.
const purgeViewAsCarts = () => {
  try {
    const alvos: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("b2b_cart_viewas_") || k.startsWith("cart_saved_for_later_viewas_")) alvos.push(k);
    }
    alvos.forEach((k) => localStorage.removeItem(k));
  } catch {}
};

const num = (v: unknown, padrao: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : padrao;
const txt = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * O localStorage e FRONTEIRA DE CONFIANCA, nao um cache nosso: o carrinho fica
 * la por meses, pode ter sido gravado por uma versao antiga do app e o proprio
 * cliente edita o valor pelo devtools. O que voltava de `JSON.parse` entrava no
 * estado CRU.
 *
 * O que isso causava:
 *  - qualquer coisa que nao fosse array (`{}`, `"x"`, `null` gravado por um bug
 *    antigo) e o `items.reduce` do `total` explodia no corpo do Provider. Como o
 *    CartProvider envolve o app inteiro, era TELA BRANCA em todas as paginas,
 *    sem jeito de sair sem limpar o storage na mao;
 *  - `quantidade` NaN/string/ausente => `total` NaN => checkout com total NaN;
 *  - `quantidade` NEGATIVA sobrevivia: `addItem` soma (`i.quantidade + ...`) sem
 *    piso e `checkCartStock` so compara `> teto`, entao a linha passava pelo
 *    submit e virava pedido com subtotal negativo.
 *
 * Item sem `produto_id` e descartado — sem ele nao ha o que comprar nem chave.
 */
export const sanitizeCart = (raw: unknown): CartItem[] => {
  if (!Array.isArray(raw)) return [];
  const out: CartItem[] = [];
  for (const bruto of raw) {
    if (!bruto || typeof bruto !== "object") continue;
    const i = bruto as Record<string, unknown>;
    if (typeof i.produto_id !== "string" || !i.produto_id) continue;
    const minimo = Math.max(1, Math.floor(num(i.quantidade_minima, 1)));
    out.push({
      ...(bruto as CartItem),
      variante_id: typeof i.variante_id === "string" ? i.variante_id : null,
      variante_label: typeof i.variante_label === "string" ? i.variante_label : null,
      imagem_url: typeof i.imagem_url === "string" ? i.imagem_url : null,
      // Texto tem que ser texto: o React lança "Objects are not valid as a React
      // child" e derruba a página inteira se `nome` vier objeto do storage.
      nome: txt(i.nome),
      sku: txt(i.sku),
      unidade_venda: txt(i.unidade_venda),
      quantidade: Math.max(minimo, Math.floor(num(i.quantidade, minimo))),
      quantidade_minima: minimo,
      preco: Math.max(0, num(i.preco, 0)),
      estoque_disponivel: num(i.estoque_disponivel, 0),
    });
  }
  return out;
};

const loadCart = (key: string): CartItem[] => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return [];
    const stored = localStorage.getItem(key);
    return stored ? sanitizeCart(JSON.parse(stored)) : [];
  } catch {
    return [];
  }
};

const CartContext = createContext<CartContextType>({
  items: [],
  addItem: () => {},
  removeItem: () => {},
  updateQuantity: () => {},
  updatePrice: () => {},
  clearCart: () => {},
  total: 0,
});

export const useCart = () => useContext(CartContext);

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const [authResolved, setAuthResolved] = useState(false);
  const { impersonatedCustomer } = useAuth();
  const viewAsId = impersonatedCustomer?.id ?? null;
  // Chave EFETIVA: durante "View as" é a do CLIENTE impersonado (cada cliente com o
  // seu carrinho); fora dele, a do usuário logado.
  const cartStorageKey = viewAsId
    ? viewAsStorageKey(viewAsId)
    : (userId ? storageKey(userId) : ANON_KEY);
  // Chave de que os `items` em memória VIERAM. Só persiste quando ela é a chave
  // efetiva de agora (senão o [] inicial sobrescreve o carrinho salvo durante a
  // corrida do auth — o "itens somem ao sair e voltar").
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);

  // Acompanha a sessão REAL (no view-as continua sendo a do admin).
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
      setAuthResolved(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      // Logout: limpa o carrinho anônimo E os rascunhos de "View as" (senão o
      // carrinho montado pelo admin dentro de um cliente fica na máquina).
      if (!uid) {
        try { localStorage.removeItem(ANON_KEY); } catch {}
        purgeViewAsCarts();
      }
      setAuthResolved(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Hidrata a partir da chave efetiva — troca de usuário OU de cliente impersonado.
  //
  // DURANTE O RENDER, e não num efeito, de propósito: `items` e a chave de onde
  // eles vieram têm que mudar no MESMO commit.
  //
  // Com a hidratação num efeito, o efeito de persistência rodava logo DEPOIS
  // dele, no mesmo commit, já com a marca da chave NOVA e ainda com os `items`
  // da chave ANTIGA — e gravava um carrinho por cima do outro:
  //   * ao trocar de cliente no "View as", `b2b_cart_viewas_<B>` recebia os
  //     itens do cliente A;
  //   * no logout, o carrinho do cliente ia parar em `b2b_cart_anon`;
  //   * na entrada (authResolved false→true), o [] inicial zerava o carrinho
  //     salvo do próprio cliente.
  // O render seguinte reescrevia com o valor certo, então o estrago só ficava no
  // disco quando a aba fechava/recarregava/travava nesse intervalo — mas aí ficava.
  if (authResolved && hydratedKey !== cartStorageKey) {
    setHydratedKey(cartStorageKey);
    setItems(loadCart(cartStorageKey));
  }

  // Persiste — só na chave de onde os itens em memória vieram.
  useEffect(() => {
    if (hydratedKey !== cartStorageKey) return;
    try {
      localStorage.setItem(cartStorageKey, JSON.stringify(items));
    } catch {}
  }, [items, cartStorageKey, hydratedKey]);

  const addItem = (item: CartItem) => {
    // Quantidade e preço saneados na ENTRADA: a tela manda NaN quando o campo de
    // quantidade está vazio (`parseInt("")`), e daí a linha — e o total do
    // carrinho inteiro — vira NaN.
    //
    // O PISO DO MÍNIMO **NÃO** ENTRA AQUI: `item.quantidade` é o quanto
    // ADICIONAR, e elevá-lo ao mínimo somaria o mínimo do produto a cada clique
    // numa linha que já existe ("move to cart" do saved-for-later, página do
    // produto). O piso vale só na primeira inserção, logo abaixo, como antes.
    const pedido = Math.max(0, Math.floor(num(item.quantidade, 0)));
    setItems((prev) => {
      const key = cartKey(item);
      const existing = prev.find((i) => cartKey(i) === key);
      if (existing) {
        return prev.map((i) => {
          if (cartKey(i) !== key) return i;
          const want = i.quantidade + pedido;
          // só limita pelo disponível quando ele é número > 0 (não rebaixa backorder/pré-venda)
          const qtd = (typeof i.estoque_disponivel === "number" && i.estoque_disponivel > 0)
            ? Math.min(want, i.estoque_disponivel) : want;
          return { ...i, quantidade: qtd };
        });
      }
      // Primeira inserção também respeita estoque/mínimo (antes entrava cru, podia
      // passar do estoque). Só limita pelo disponível quando ele é um número > 0
      // (não rebaixa backorder/pré-venda, que podem ter disponível 0).
      const avail = item.estoque_disponivel;
      const capped = (typeof avail === "number" && avail > 0) ? Math.min(pedido, avail) : pedido;
      const qtd = Math.max(Math.max(1, Math.floor(num(item.quantidade_minima, 1))), capped);
      return [...prev, { ...item, quantidade: qtd, preco: Math.max(0, num(item.preco, 0)) }];
    });
  };

  const removeItem = (key: string) => {
    setItems((prev) => prev.filter((i) => cartKey(i) !== key));
  };

  const updateQuantity = (key: string, quantidade: number) => {
    setItems((prev) =>
      prev.map((i) => {
        if (cartKey(i) !== key) return i;
        // O campo de quantidade do Carrinho manda `parseInt(...) || quantidade_minima`
        // — com `quantidade_minima` ausente num item velho isso chega como
        // `undefined`, e `Math.max(min, Math.min(undefined, ...))` é NaN: a linha
        // ficava NaN e levava o total do carrinho inteiro junto. Valor inválido
        // MANTÉM a quantidade atual, não a destrói.
        const pedido = Math.floor(num(quantidade, i.quantidade));
        // só limita pelo disponível quando número > 0 (não trava backorder/pré-venda em 0)
        const capped = (typeof i.estoque_disponivel === "number" && i.estoque_disponivel > 0)
          ? Math.min(pedido, i.estoque_disponivel) : pedido;
        return { ...i, quantidade: Math.max(i.quantidade_minima ?? 1, capped) };
      })
    );
  };

  // Ajusta SO o preco de uma linha ja existente. Serve pro catalogo adicionar na
  // hora (preco da vitrine) e corrigir depois, em segundo plano, com o preco da
  // faixa de desconto — sem fazer o cliente esperar a consulta antes de ver o
  // item entrar no carrinho.
  const updatePrice = (key: string, preco: number, quantidadeEsperada?: number) => {
    if (!Number.isFinite(preco)) return;
    setItems((prev) => prev.map((i) => {
      if (cartKey(i) !== key) return i;
      // `quantidadeEsperada`: o preco foi calculado PRA UMA quantidade. Se ela mudou
      // enquanto a consulta estava no ar (o cliente clicou "Update quantity"), o
      // preco que voltou e de outra faixa de desconto — aplicar deixaria o carrinho
      // com um total errado, que so se corrigiria na finalizacao.
      if (quantidadeEsperada !== undefined && i.quantidade !== quantidadeEsperada) return i;
      return { ...i, preco };
    }));
  };

  const clearCart = () => {
    setItems([]);
    // Precisa apagar a chave EFETIVA. Usando `storageKey(userId)` aqui, um
    // "DELETE ALL" / checkout feito dentro do "View as" apagava o carrinho pessoal
    // do ADMIN (userId = admin) e deixava o do cliente impersonado intacto.
    try { localStorage.removeItem(cartStorageKey); } catch {}
  };

  const total = items.reduce((sum, i) => sum + i.preco * i.quantidade, 0);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, updateQuantity, updatePrice, clearCart, total }}>
      {children}
    </CartContext.Provider>
  );
};
