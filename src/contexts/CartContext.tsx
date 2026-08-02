import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
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
// "@/lib/stock" (módulo puro, sem arrastar o cliente Supabase junto) e é
// re-exportada aqui para não quebrar os imports existentes.
export { cartKey } from "@/lib/stock";

interface CartContextType {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (key: string) => void;       // key = cartKey(item)
  updateQuantity: (key: string, quantidade: number) => void;
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
  const [authResolved, setAuthResolved] = useState(false);
  const { impersonatedCustomer } = useAuth();
  const viewAsId = impersonatedCustomer?.id ?? null;
  // Chave EFETIVA: durante "View as" é a do CLIENTE impersonado (cada cliente com o
  // seu carrinho); fora dele, a do usuário logado.
  const cartStorageKey = viewAsId
    ? viewAsStorageKey(viewAsId)
    : (userId ? storageKey(userId) : ANON_KEY);
  // Só persiste DEPOIS que a chave ATUAL foi hidratada do localStorage. Sem isto, o
  // [] inicial podia sobrescrever o carrinho salvo durante a corrida do auth (causa
  // do "itens somem ao sair e voltar") — e, ao TROCAR de chave, os itens da chave
  // antiga seriam gravados na nova.
  const hydratedKeyRef = useRef<string | null>(null);

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
  useEffect(() => {
    if (!authResolved) return;
    setItems(loadCart(cartStorageKey));
    hydratedKeyRef.current = cartStorageKey;
  }, [authResolved, cartStorageKey]);

  // Persiste — só na chave que já foi hidratada (evita gravar itens da chave antiga).
  useEffect(() => {
    if (hydratedKeyRef.current !== cartStorageKey) return;
    try {
      localStorage.setItem(cartStorageKey, JSON.stringify(items));
    } catch {}
  }, [items, cartStorageKey]);

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
    // Precisa apagar a chave EFETIVA. Usando `storageKey(userId)` aqui, um
    // "DELETE ALL" / checkout feito dentro do "View as" apagava o carrinho pessoal
    // do ADMIN (userId = admin) e deixava o do cliente impersonado intacto.
    try { localStorage.removeItem(cartStorageKey); } catch {}
  };

  const total = items.reduce((sum, i) => sum + i.preco * i.quantidade, 0);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, updateQuantity, clearCart, total }}>
      {children}
    </CartContext.Provider>
  );
};
