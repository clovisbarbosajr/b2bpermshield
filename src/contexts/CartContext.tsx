import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

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

// Identidade de uma linha do carrinho = produto + variante. Duas variantes do mesmo
// produto são linhas DISTINTAS. Item sem variante => chave "produto::".
export const cartKey = (i: { produto_id: string; variante_id?: string | null }) =>
  `${i.produto_id}::${i.variante_id ?? ""}`;

interface CartContextType {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (key: string) => void;       // key = cartKey(item)
  updateQuantity: (key: string, quantidade: number) => void;
  clearCart: () => void;
  total: number;
}

const storageKey = (userId: string) => `b2b_cart_${userId}`;
const ANON_KEY = "b2b_cart_anon";

const loadCart = (key: string): CartItem[] => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return [];
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const CartContext = createContext<CartContextType>({
  items: [],
  addItem: () => {},
  removeItem: () => {},
  updateQuantity: () => {},
  clearCart: () => {},
  total: 0,
});

export const useCart = () => useContext(CartContext);

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  // Só persiste DEPOIS que o carrinho do usuário foi hidratado do localStorage.
  // Sem isto, o [] inicial podia sobrescrever o carrinho salvo durante a corrida
  // do auth (causa do "itens somem ao sair e voltar").
  const hydratedRef = useRef(false);

  // On auth state change: switch cart to the logged-in user's cart, clear on logout
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      setItems(loadCart(uid ? storageKey(uid) : ANON_KEY));
      hydratedRef.current = true;
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      if (!uid) {
        // User logged out — clear cart completely
        setItems([]);
        try { localStorage.removeItem(ANON_KEY); } catch {}
      } else {
        // New user logged in — load their own cart
        setItems(loadCart(storageKey(uid)));
      }
      hydratedRef.current = true;
    });

    return () => subscription.unsubscribe();
  }, []);

  // Persist to localStorage whenever cart changes — só após a hidratação inicial.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const key = userId ? storageKey(userId) : ANON_KEY;
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch {}
  }, [items, userId]);

  const addItem = (item: CartItem) => {
    setItems((prev) => {
      const key = cartKey(item);
      const existing = prev.find((i) => cartKey(i) === key);
      if (existing) {
        return prev.map((i) => {
          if (cartKey(i) !== key) return i;
          const want = i.quantidade + item.quantidade;
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
      const capped = (typeof avail === "number" && avail > 0) ? Math.min(item.quantidade, avail) : item.quantidade;
      const qtd = Math.max(item.quantidade_minima ?? 1, capped);
      return [...prev, { ...item, quantidade: qtd }];
    });
  };

  const removeItem = (key: string) => {
    setItems((prev) => prev.filter((i) => cartKey(i) !== key));
  };

  const updateQuantity = (key: string, quantidade: number) => {
    setItems((prev) =>
      prev.map((i) => {
        if (cartKey(i) !== key) return i;
        // só limita pelo disponível quando número > 0 (não trava backorder/pré-venda em 0)
        const capped = (typeof i.estoque_disponivel === "number" && i.estoque_disponivel > 0)
          ? Math.min(quantidade, i.estoque_disponivel) : quantidade;
        return { ...i, quantidade: Math.max(i.quantidade_minima ?? 1, capped) };
      })
    );
  };

  const clearCart = () => {
    setItems([]);
    const key = userId ? storageKey(userId) : ANON_KEY;
    try { localStorage.removeItem(key); } catch {}
  };

  const total = items.reduce((sum, i) => sum + i.preco * i.quantidade, 0);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, updateQuantity, clearCart, total }}>
      {children}
    </CartContext.Provider>
  );
};
