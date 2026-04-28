import { createContext, useContext, useState, useEffect, ReactNode } from "react";

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

const STORAGE_KEY = "b2b_cart";

const loadCart = (): CartItem[] => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return [];
    const stored = localStorage.getItem(STORAGE_KEY);
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
  const [items, setItems] = useState<CartItem[]>(loadCart);

  // Persist to localStorage whenever cart changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }, [items]);

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
      prev.map((i) => (i.produto_id === produto_id ? { ...i, quantidade: Math.max(i.quantidade_minima, Math.min(quantidade, i.estoque_disponivel)) } : i))
    );
  };

  const clearCart = () => {
    setItems([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  };

  const total = items.reduce((sum, i) => sum + i.preco * i.quantidade, 0);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, updateQuantity, clearCart, total }}>
      {children}
    </CartContext.Provider>
  );
};
