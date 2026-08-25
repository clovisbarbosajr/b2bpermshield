import React, { createContext, useContext, useEffect, useRef, useState } from "react";
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
  // Conta de cliente aprovada? `false` manda para /pending-approval.
  //
  // O portão de verdade é o BANCO (`cliente_conta_liberada`, 20260825280000):
  // conta pendente enxerga catálogo VAZIO mesmo chamando a API direto. Isto aqui
  // é só a tela — existe para o cliente ver "aguardando aprovação" em vez de uma
  // loja vazia sem explicação.
  contaAprovada: boolean;
  signOut: () => Promise<void>;
  clearViewAs: (dest?: string) => void;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  role: null,
  permissions: {},
  hasPermission: () => false,
  loading: true,
  isDemo: false,
  contaAprovada: true,
  impersonatedCustomer: null,
  canPlaceOrders: true,
  isSubUser: false,
  signOut: async () => {},
  clearViewAs: () => {},
});

export const useAuth = () => useContext(AuthContext);

const VIEW_AS_KEY = "viewAsCustomer";
// Modo demo (sessionStorage "demo_role") REMOVIDO no go-live (2026-07-03): permitia abrir o
// shell da UI sem login (dados sempre bloqueados pela RLS, mas não deve existir em produção).
// isDemo continua existindo — o "view as" (impersonação) usa pra marcar sessão sintética.

// IMPORTANTE: view-as vive em sessionStorage (POR ABA), não localStorage.
// localStorage é compartilhado por todas as abas do domínio — com ele, clicar
// "View as" transformava TODAS as abas abertas na visão do cliente (bug).
// Com sessionStorage, só a aba que consumiu o token impersona; as outras
// continuam com a sessão staff normal.
const getStoredViewAsCustomer = (): ViewAsCustomer | null => {
  const raw = sessionStorage.getItem(VIEW_AS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ViewAsCustomer;
  } catch {
    sessionStorage.removeItem(VIEW_AS_KEY);
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
  // Último user.id já inicializado — evita re-inicializar (e desmontar o app) em
  // TOKEN_REFRESHED/SIGNED_IN do mesmo usuário (ex.: ao voltar pra aba).
  const initializedUserRef = useRef<string | null>(null);
  const [impersonatedCustomer, setImpersonatedCustomer] = useState<ViewAsCustomer | null>(null);
  const [canPlaceOrders, setCanPlaceOrders] = useState<boolean>(true);
  const [isSubUser, setIsSubUser] = useState<boolean>(false);
  const [contaAprovada, setContaAprovada] = useState<boolean>(true);

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
      setContaAprovada(true);
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
        .select("id, parent_customer_id, can_confirm_order")
        .eq("user_id", userId)
        .maybeSingle();
      setCanPlaceOrders(!(me?.parent_customer_id && me?.can_confirm_order === false));
      setIsSubUser(!!me?.parent_customer_id);
      // `contaAprovada` NÃO é resolvida aqui — ver `initUserSession`. Dois
      // motivos: a ficha pode ainda não existir neste ponto, e a regra mora no
      // banco.
      return "cliente";
    }

    // Sem papel (pendente de aprovação).
    setRole(null);
    setPermissions({});
    setCanPlaceOrders(true);
    setIsSubUser(false);
    setContaAprovada(false);
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
    await (supabase as any).rpc("ensure_my_cliente_record", {
      _nome: nomeFromMetadata || emailFromAuth || "Cliente",
      _empresa: empresaFromMetadata || "",
    });
  };

  // Initialize a user session: fetch role first, then only ensure cliente record for customers
  // Pergunta ao BANCO se a conta está liberada, em vez de recalcular aqui.
  //
  // Eu tinha escrito essa regra de novo no navegador, lendo `clientes.status` — e
  // para sub-usuário lia a ficha do PAI. Era código morto: a policy que permitia
  // isso (`Contacts read company cliente`) morreu junto com `is_company_contact`,
  // dropada com CASCADE em 20260622000000. A consulta voltava vazia sem erro, e o
  // funcionário de uma empresa suspensa entrava no portal e via loja vazia — a
  // situação exata que a tela existia para evitar.
  //
  // E duas cópias de uma regra de segurança divergem. A tela pergunta, o banco
  // responde: `minha_conta_liberada()` (20260825280000) chama o mesmo
  // `cliente_conta_liberada()` que as funções de visibilidade usam.
  const carregarContaAprovada = async () => {
    const { data, error } = await (supabase as any).rpc("minha_conta_liberada");
    if (error) {
      // FALHA DE LEITURA NÃO BLOQUEIA — e é registrada. O banco já é o portão
      // real (catálogo volta vazio), então travar a tela por erro de rede
      // transformaria uma falha nossa em cliente legítimo trancado do lado de
      // fora. Sem este log, uma falha sistemática após um deploy deixaria todo
      // mundo "aprovado" na tela e ninguém descobriria.
      console.error("[auth] minha_conta_liberada falhou; liberando a TELA", error);
      setContaAprovada(true);
      return;
    }
    setContaAprovada(data === true);
  };

  const initUserSession = async (authUser: User) => {
    const resolvedRole = await fetchRoleAndPermissions(authUser.id);
    if (resolvedRole === "cliente" || resolvedRole === null) {
      // Sub-usuário já tem registro próprio em `clientes` (criado pelo admin com
      // parent_customer_id) — claim_customer_record o encontra pelo user_id e não
      // duplica. Cliente novo de verdade é criado aqui.
      await ensureClienteRecord(authUser);
      // DEPOIS de garantir a ficha, e não antes.
      //
      // Lendo o status antes, uma ficha MIGRADA (que `ensure_my_cliente_record`
      // adota pelo e-mail, já `ativo`) ainda não existia vinculada ao usuário: a
      // consulta voltava vazia, a conta era tratada como pendente, e o cliente
      // legítimo caía em /pending-approval no primeiro login — justamente no dia
      // da migração. Só entrava na segunda tentativa.
      await carregarContaAprovada();
    } else {
      setContaAprovada(true); // staff
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
    // Higiene: versões antigas guardavam o view-as no localStorage (compartilhado
    // entre abas — causa do bug "todas as abas viram o cliente"). Remove qualquer
    // resíduo antigo pra ele não sequestrar sessões depois de um deploy.
    localStorage.removeItem(VIEW_AS_KEY);

    const viewAsCustomer = getStoredViewAsCustomer();
    if (viewAsCustomer) {
      applyViewAsSession(viewAsCustomer);
      // GUARDA: view-as só vale se a sessão REAL do navegador for de ADMIN
      // (regra de negócio: só admin impersona cliente — manager/warehouse não).
      // Sem isso, uma chave "viewAsCustomer" pendurada no storage sequestrava até
      // o login de um CLIENTE real (ele abria o portal "como" outro cliente) — e o
      // "Return to" do banner revelava a sessão errada. Se a sessão não é admin
      // (ou não existe), limpa a chave e reinicia como o usuário real.
      supabase.auth.getSession().then(async ({ data: { session: real } }) => {
        let isAdmin = false;
        if (real?.user?.id) {
          const { data } = await (supabase as any)
            .from("user_roles").select("role").eq("user_id", real.user.id).maybeSingle();
          isAdmin = data?.role === "admin";
        }
        if (!isAdmin) {
          sessionStorage.removeItem(VIEW_AS_KEY);
          window.location.replace("/");
        }
      });
      // ABA ZUMBI: este branch retorna cedo e não assinava NENHUM listener de
      // auth. Se a admin fizesse logout em OUTRA aba, esta aba impersonada não
      // ficava sabendo — seguia mostrando o portal com a sessão real morta
      // (RLS bloqueia os dados, mas a aba quebra silenciosamente). O supabase-js
      // propaga SIGNED_OUT entre abas; ao recebê-lo, encerra o view-as junto.
      const { data: { subscription: viewAsSub } } = supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
          sessionStorage.removeItem(VIEW_AS_KEY);
          window.location.replace("/");
        }
      });
      return () => viewAsSub.unsubscribe();
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Logout limpa a impersonação — senão um "ver como cliente" esquecido vaza
      // pro próximo login no mesmo navegador (ficava preso na visão do cliente).
      if (_event === "SIGNED_OUT") sessionStorage.removeItem(VIEW_AS_KEY);
      const activeViewAsCustomer = _event === "SIGNED_OUT" ? null : getStoredViewAsCustomer();
      if (activeViewAsCustomer) {
        applyViewAsSession(activeViewAsCustomer);
        return;
      }

      // Voltar pra aba / renovação de token dispara SIGNED_IN|TOKEN_REFRESHED com o
      // MESMO usuário. Re-inicializar aqui punha o app em "loading" → a página inteira
      // desmontava e o usuário PERDIA o que estava digitando (ex.: popup de preços).
      // Mesmo usuário já inicializado → só atualiza a sessão e segue.
      if (nextSession?.user && initializedUserRef.current === nextSession.user.id) {
        setSession(nextSession);
        setUser(nextSession.user);
        return;
      }

      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setImpersonatedCustomer(null);
      setCanPlaceOrders(true);
      setIsSubUser(false);
      setIsDemo(false);

      if (nextSession?.user) {
        initializedUserRef.current = nextSession.user.id;
        setLoading(true);
        // Fire-and-forget: do NOT await inside onAuthStateChange
        // Awaiting causes signInWithPassword to hang in Supabase JS v2
        initUserSession(nextSession.user).finally(() => setLoading(false));
      } else {
        initializedUserRef.current = null;
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

      // onAuthStateChange pode já ter inicializado este usuário — não repete.
      if (nextSession?.user && initializedUserRef.current === nextSession.user.id) {
        setSession(nextSession);
        setUser(nextSession.user);
        return;
      }

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (nextSession?.user) {
        initializedUserRef.current = nextSession.user.id;
        setLoading(true);
        initUserSession(nextSession.user).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const clearViewAs = (dest: string = "/admin/customers") => {
    sessionStorage.removeItem(VIEW_AS_KEY);
    setImpersonatedCustomer(null);
    window.location.href = dest;
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
    sessionStorage.removeItem(VIEW_AS_KEY); // garante que não fica impersonação pendurada
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
        contaAprovada,
        signOut,
        clearViewAs,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
