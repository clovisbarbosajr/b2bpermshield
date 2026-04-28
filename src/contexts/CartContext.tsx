import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CartItem = {
  produto_id: string;
  nome: string;
  sku: string;
  preco: number;
  quantidade: number;
  unidade_venda: string;
  quantidade_minima: number;
  estoque_disponivel: number;
  imagem_url?: string | null;
};

interface CartContextType {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (produto_id: string) => void;
  updateQuantity: (produto_id: string, quantidade: number) => void;
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

  // On auth state change: switch cart to the logged-in user's cart, clear on logout
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      setItems(loadCart(uid ? storageKey(uid) : ANON_KEY));
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
    });

    return () => subscription.unsubscribe();
  }, []);

  // Persist to localStorage whenever cart changes
  useEffect(() => {
    const key = userId ? storageKey(userId) : ANON_KEY;
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch {}
  }, [items, userId]);

  const addItem = (item: CartItem) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.produto_id === item.produto_id);
      if (existing) {
        return prev.map((i) =>
          i.produto_id === item.produto_id
            ? { ...i, quantidade: Math.min(i.quantidade + item.quantidade, i.estoque_disponivel) }
            : i
        );
      }
      return [...prev, item];
    });
  };

  const removeItem = (produto_id: string) => {
    setItems((prev) => prev.filter((i) => i.produto_id !== produto_id));
  };

  const updateQuantity = (produto_id: string, quantidade: number) => {
    setItems((prev) =>
      prev.map((i) =>
        i.produto_id === produto_id
          ? { ...i, quantidade: Math.max(i.quantidade_minima, Math.min(quantidade, i.estoque_disponivel)) }
          : i
      )
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
