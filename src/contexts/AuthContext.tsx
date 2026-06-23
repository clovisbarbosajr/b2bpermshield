import React, { createContext, useContext, useEffect, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "cliente" | "warehouse" | "manager";

type ViewAsCustomer = {
  id: string;
  user_id?: string;
  empresa?: string;
  nome?: string;
  email?: string;
  tabela_preco_id?: string | null;
};

interface AuthContextType {
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  permissions: Record<string, boolean>;
  hasPermission: (key: string) => boolean;
  loading: boolean;
  isDemo: boolean;
  impersonatedCustomer: ViewAsCustomer | null;
  // Sub-usuário (clientes com parent) sem "confirmar pedido" não finaliza compra.
  canPlaceOrders: boolean;
  // É um sub-usuário (tem parent_customer_id)? Só o DONO da conta gerencia a equipe.
  isSubUser: boolean;
  signOut: () => Promise<void>;
  loginAsDemo: (demoRole: AppRole) => void;
  clearViewAs: () => void;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  role: null,
  permissions: {},
  hasPermission: () => false,
  loading: true,
  isDemo: false,
  impersonatedCustomer: null,
  canPlaceOrders: true,
  isSubUser: false,
  signOut: async () => {},
  loginAsDemo: () => {},
  clearViewAs: () => {},
});

export const useAuth = () => useContext(AuthContext);

const VIEW_AS_KEY = "viewAsCustomer";
const DEMO_ROLE_KEY = "demo_role";

const getStoredViewAsCustomer = (): ViewAsCustomer | null => {
  const raw = localStorage.getItem(VIEW_AS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ViewAsCustomer;
  } catch {
    localStorage.removeItem(VIEW_AS_KEY);
    return null;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [impersonatedCustomer, setImpersonatedCustomer] = useState<ViewAsCustomer | null>(null);
  const [canPlaceOrders, setCanPlaceOrders] = useState<boolean>(true);
  const [isSubUser, setIsSubUser] = useState<boolean>(false);

  // Admin always has full access; for others check the permissions map
  const hasPermission = (key: string): boolean => {
    if (role === "admin") return true;
    return permissions[key] === true;
  };

  // Fetch role + permissions, returns the resolved role
  const fetchRoleAndPermissions = async (userId: string): Promise<AppRole | null> => {
    const { data } = await (supabase as any)
      .from("user_roles")
      .select("role, permissions")
      .eq("user_id", userId)
      .maybeSingle();
    const dbRole = data?.role as AppRole | undefined;

    // STAFF (admin/manager/warehouse) tem prioridade.
    if (dbRole && dbRole !== "cliente") {
      setRole(dbRole);
      setPermissions((data as any).permissions || {});
      setCanPlaceOrders(true);
      setIsSubUser(false);
      return dbRole;
    }

    // Cliente — INCLUI sub-usuário (modelo B2BWave: registro próprio em `clientes`
    // com `parent_customer_id` + flags). Ele resolve sozinho pelo user_id, herda a
    // tabela de preço do pai e segue as 2 flags. Não há mais "contato de empresa".
    if (dbRole === "cliente") {
      setRole("cliente");
      setPermissions((data as any).permissions || {});
      // Sub-usuário SEM "confirmar pedido sem aprovação" não finaliza compra (igual B2BWave).
      const { data: me } = await supabase
        .from("clientes")
        .select("parent_customer_id, can_confirm_order")
        .eq("user_id", userId)
        .maybeSingle();
      setCanPlaceOrders(!(me?.parent_customer_id && me?.can_confirm_order === false));
      setIsSubUser(!!me?.parent_customer_id);
      return "cliente";
    }

    // Sem papel (pendente de aprovação).
    setRole(null);
    setPermissions({});
    setCanPlaceOrders(true);
    setIsSubUser(false);
    return null;
  };

  // Only run for actual customer accounts — never for admin/manager/warehouse
  const ensureClienteRecord = async (authUser: User) => {
    const nomeFromMetadata = typeof authUser.user_metadata?.nome === "string" ? authUser.user_metadata.nome.trim() : "";
    const empresaFromMetadata =
      typeof authUser.user_metadata?.empresa === "string" ? authUser.user_metadata.empresa.trim() : "";
    const emailFromAuth = typeof authUser.email === "string" ? authUser.email.trim() : "";

    // Acha/vincula/cria o registro em UMA RPC SECURITY DEFINER. Cliente novo é criado
    // com defaults seguros forçados no servidor (sem INSERT direto, que a RLS bloqueia
    // e que permitiria forjar price list/aprovação no insert).
    await supabase.rpc("ensure_my_cliente_record", {
      _nome: nomeFromMetadata || emailFromAuth || "Cliente",
      _empresa: empresaFromMetadata || "",
    });
  };

  // Initialize a user session: fetch role first, then only ensure cliente record for customers
  const initUserSession = async (authUser: User) => {
    const resolvedRole = await fetchRoleAndPermissions(authUser.id);
    if (resolvedRole === "cliente" || resolvedRole === null) {
      // Sub-usuário já tem registro próprio em `clientes` (criado pelo admin com
      // parent_customer_id) — claim_customer_record o encontra pelo user_id e não
      // duplica. Cliente novo de verdade é criado aqui.
      await ensureClienteRecord(authUser);
    }
  };

  const applyViewAsSession = (customer: ViewAsCustomer) => {
    const effectiveUserId = customer.user_id ?? customer.id;
    setImpersonatedCustomer(customer);
    setCanPlaceOrders(true);
    setIsSubUser(false);
    setIsDemo(true);
    setRole("cliente");
    setPermissions({});
    setUser({
      id: effectiveUserId,
      email: customer.email ?? "viewas@demo",
      aud: "authenticated",
      app_metadata: {},
      user_metadata: { nome: customer.nome, empresa: customer.empresa },
      created_at: new Date().toISOString(),
    } as unknown as User);
    setSession(null);
    setLoading(false);
  };

  useEffect(() => {
    const viewAsCustomer = getStoredViewAsCustomer();
    if (viewAsCustomer) {
      applyViewAsSession(viewAsCustomer);
      return;
    }

    const demoRole = sessionStorage.getItem(DEMO_ROLE_KEY) as AppRole | null;
    if (demoRole) {
      setIsDemo(true);
      setRole(demoRole);
      setPermissions({});
      setUser({ id: "demo", email: demoRole === "admin" ? "admin@demo" : "user@demo" } as User);
      setLoading(false);
      return;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Logout limpa a impersonação — senão um "ver como cliente" esquecido vaza
      // pro próximo login no mesmo navegador (ficava preso na visão do cliente).
      if (_event === "SIGNED_OUT") localStorage.removeItem(VIEW_AS_KEY);
      const activeViewAsCustomer = _event === "SIGNED_OUT" ? null : getStoredViewAsCustomer();
      if (activeViewAsCustomer) {
        applyViewAsSession(activeViewAsCustomer);
        return;
      }

      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setImpersonatedCustomer(null);
      setCanPlaceOrders(true);
      setIsSubUser(false);
      setIsDemo(false);

      if (nextSession?.user) {
        setLoading(true);
        // Fire-and-forget: do NOT await inside onAuthStateChange
        // Awaiting causes signInWithPassword to hang in Supabase JS v2
        initUserSession(nextSession.user).finally(() => setLoading(false));
      } else {
        setRole(null);
        setPermissions({});
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session: nextSession } }) => {
      const activeViewAsCustomer = getStoredViewAsCustomer();
      if (activeViewAsCustomer) {
        applyViewAsSession(activeViewAsCustomer);
        return;
      }

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (nextSession?.user) {
        setLoading(true);
        initUserSession(nextSession.user).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loginAsDemo = (demoRole: AppRole) => {
    localStorage.removeItem(VIEW_AS_KEY);
    sessionStorage.setItem(DEMO_ROLE_KEY, demoRole);
    setImpersonatedCustomer(null);
    setIsDemo(true);
    setRole(demoRole);
    setPermissions({});
    setUser({ id: "demo", email: demoRole === "admin" ? "admin@demo" : "user@demo" } as User);
    setLoading(false);
  };

  const clearViewAs = () => {
    localStorage.removeItem(VIEW_AS_KEY);
    setImpersonatedCustomer(null);
    window.location.href = "/admin/customers";
  };

  const signOut = async () => {
    if (impersonatedCustomer) {
      clearViewAs();
      setIsDemo(false);
      setRole(null);
      setPermissions({});
      setUser(null);
      setSession(null);
      return;
    }
    if (isDemo) {
      sessionStorage.removeItem(DEMO_ROLE_KEY);
      setIsDemo(false);
      setRole(null);
      setPermissions({});
      setUser(null);
      setSession(null);
      return;
    }
    localStorage.removeItem(VIEW_AS_KEY); // garante que não fica impersonação pendurada
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        role,
        permissions,
        hasPermission,
        loading,
        isDemo,
        impersonatedCustomer,
        canPlaceOrders,
        isSubUser,
        signOut,
        loginAsDemo,
        clearViewAs,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
