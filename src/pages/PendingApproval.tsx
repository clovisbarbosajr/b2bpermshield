import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, XCircle, ShieldOff, AlertTriangle } from "lucide-react";

const PendingApproval = () => {
  const { user, signOut } = useAuth();
  const [clienteStatus, setClienteStatus] = useState<string | null>(null);
  const [erroLeitura, setErroLeitura] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("clientes")
      .select("status, is_active")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        // FALHA DE LEITURA NAO E "CONTA PENDENTE". O `error` era descartado na
        // desestruturacao: um 500 do PostgREST, rede caindo ou RLS mudando
        // deixavam `data` nulo, a tela caia no padrao `pendente` e dizia
        // "vamos aprovar em breve" para quem estava DESATIVADO ou SUSPENSO —
        // afirmando o que o codigo nao sabe. Agora o erro tem estado proprio.
        if (error) {
          console.error("[pending-approval] leitura de clientes falhou", error);
          setErroLeitura(true);
          return;
        }
        setErroLeitura(false);
        // DOIS ERROS DE MAPA, os dois alcancaveis. `cliente_status` so tem
        // ativo | inativo | pendente (types.ts:3234).
        //
        // 1. `inativo` nao tinha entrada: caia no `?? config["pendente"]` e a
        //    conta DESATIVADA pelo admin lia "seu cadastro foi recebido, um
        //    administrador vai aprovar em breve".
        // 2. `is_active` era testado ANTES do status. `ImportCustomers` cria
        //    cliente novo com `pendente` + `is_active:false` (linha 113) — nunca
        //    aprovado, nao suspenso —, e esse e o caminho normal do 1o login de
        //    um cliente importado. Ele lia "sua conta foi suspensa".
        //
        // `pendente` ganha do `is_active`; so depois vale o desligamento.
        if (data) {
          const st = data.status ?? "pendente";
          setClienteStatus(
            st === "pendente" ? "pendente"
            : (st === "inativo" || data.is_active === false) ? "bloqueado"
            : st,
          );
        }
      });
  }, [user]);

  const config: Record<string, { icon: React.ReactNode; title: string; desc: string }> = {
    pendente: {
      icon: <Clock className="h-12 w-12 text-amber-400 mx-auto mb-4" />,
      title: "Account Pending Approval",
      desc: "Your registration was received. An administrator will review and approve your account shortly.",
    },
    rejeitado: {
      icon: <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />,
      title: "Registration Not Approved",
      desc: "Your registration request was not approved. Please contact support for more information.",
    },
    bloqueado: {
      icon: <ShieldOff className="h-12 w-12 text-destructive mx-auto mb-4" />,
      title: "Account Suspended",
      desc: "Your account has been suspended. Please contact support.",
    },
    // FALLBACK de status sem entrada — hoje so `ativo`, e chegar aqui com a
    // propria ficha ativa significa que o bloqueio veio de FORA dela: a conta da
    // EMPRESA (`conta_liberada_de` herda do `parent_customer_id`) ou a falta da
    // linha em `user_roles`. Antes caia em `config["pendente"]` e essa pessoa
    // lia "seu cadastro sera aprovado em breve" — falso, e ela esperava para
    // sempre. Texto neutro de proposito: nao afirma o motivo (que esta tela nao
    // le) e nao conta a um funcionario que a empresa dele foi suspensa.
    sem_acesso: {
      icon: <ShieldOff className="h-12 w-12 text-destructive mx-auto mb-4" />,
      title: "Your account cannot access the portal",
      desc: "This account is not able to sign in to the portal right now. Please contact support and we will sort it out.",
    },
    desconhecido: {
      icon: <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto mb-4" />,
      title: "We could not check your account status",
      desc: "Something failed on our side while loading your account. Reload this page, and contact support if it keeps happening.",
    },
  };

  const { icon, title, desc } = erroLeitura
    ? config["desconhecido"]
    // `clienteStatus` nulo = ficha ainda nao lida / inexistente: continua
    // "pendente". So status LIDO e sem entrada cai em `sem_acesso`.
    : clienteStatus === null
      ? config["pendente"]
      : (config[clienteStatus] ?? config["sem_acesso"]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mt-4">{icon}</div>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription className="mt-2">{desc}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Logged in as <strong>{user?.email}</strong>
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button
            variant="outline"
            className="w-full"
            onClick={async () => {
              await signOut();
            }}
          >
            Sign Out
          </Button>
          <Link to="/login" className="text-sm text-accent hover:underline">
            Back to login
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
};

export default PendingApproval;
