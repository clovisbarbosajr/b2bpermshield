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
  contactRole?: string | null;
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
  contactRole: string | null;
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
  contactRole: null,
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
  const [contactRole, setContactRole] = useState<string | null>(null);

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

    // STAFF (admin/manager/warehouse) tem prioridade e NUNCA é contato de empresa.
    if (dbRole && dbRole !== "cliente") {
      setRole(dbRole);
      setPermissions((data as any).permissions || {});
      return dbRole;
    }

    // Cliente OU sem papel: PRIMEIRO checa se é contato de empresa (sub-login).
    // (Antes o `return` no role 'cliente' impedia isso — o contato nunca resolvia a empresa.)
    const { data: contact } = await supabase
      .from("company_contacts")
      .select("id, cliente_id, nome, email, role, clientes(id, empresa, nome, email, tabela_preco_id, user_id)")
      .eq("user_id", userId)
      .eq("ativo", true)
      .maybeSingle();

    if (contact && contact.clientes) {
      const company = contact.clientes as any;
      const viewAs: ViewAsCustomer = {
        id: company.id,
        user_id: company.user_id,
        empresa: company.empresa,
        nome: contact.nome,
        email: contact.email,
        tabela_preco_id: company.tabela_preco_id,
        contactRole: contact.role,
      };
      localStorage.setItem("viewAsCustomer", JSON.stringify(viewAs));
      setImpersonatedCustomer(viewAs);
      setContactRole(contact.role);
      setRole("cliente");
      setPermissions({});
      return "cliente";
    }

    // Não é contato: cliente normal (com papel 'cliente') ou sem papel (pendente).
    if (dbRole === "cliente") {
      setRole("cliente");
      setPermissions((data as any).permissions || {});
      return "cliente";
    }
    setRole(null);
    setPermissions({});
    return null;
  };

  // Only run for actual customer accounts — never for admin/manager/warehouse
  const ensureClienteRecord = async (authUser: User) => {
    const nomeFromMetadata = typeof authUser.user_metadata?.nome === "string" ? authUser.user_metadata.nome.trim() : "";
    const empresaFromMetadata =
      typeof authUser.user_metadata?.empresa === "string" ? authUser.user_metadata.empresa.trim() : "";
    const emailFromAuth = typeof authUser.email === "string" ? authUser.email.trim() : "";

    // 1) Tenta achar/vincular o registro — inclui LIGAR um registro vindo do sync
    // (que tem user_id aleatório) a este login, casando pelo email do JWT.
    const { data: claimedId } = await supabase.rpc("claim_customer_record");
    if (claimedId) return; // já existe (ou acabou de ser vinculado) — nada a criar.

    // 2) Nenhum registro encontrado: é um cliente novo de verdade → cria.
    const nome = nomeFromMetadata || emailFromAuth || "Cliente";
    const empresa = empresaFromMetadata || "";
    await supabase
      .from("clientes")
      .upsert(
        { user_id: authUser.id, nome, email: emailFromAuth, empresa, status: "pendente" as any },
        { onConflict: "user_id" },
      )
      .select("id")
      .single();
  };

  // Initialize a user session: fetch role first, then only ensure cliente record for customers
  const initUserSession = async (authUser: User) => {
    const resolvedRole = await fetchRoleAndPermissions(authUser.id);
    if (resolvedRole === "cliente" || resolvedRole === null) {
      // CONTATO de empresa NÃO cria/vincula registro próprio em `clientes` (usa o da
      // empresa). Sem isso, o claim_customer_record sequestraria/criaria um cliente errado.
      const { data: contact } = await supabase
        .from("company_contacts")
        .select("id")
        .eq("user_id", authUser.id)
        .eq("ativo", true)
        .maybeSingle();
      if (!contact) await ensureClienteRecord(authUser);
    }
  };

  const applyViewAsSession = (customer: ViewAsCustomer) => {
    const effectiveUserId = customer.user_id ?? customer.id;
    setImpersonatedCustomer(customer);
    setContactRole(customer.contactRole ?? null);
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
      const activeViewAsCustomer = getStoredViewAsCustomer();
      if (activeViewAsCustomer) {
        applyViewAsSession(activeViewAsCustomer);
        return;
      }

      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setImpersonatedCustomer(null);
      setContactRole(null);
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
        contactRole,
        signOut,
        loginAsDemo,
        clearViewAs,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
