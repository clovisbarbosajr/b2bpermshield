import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Action = "created" | "updated" | "deleted";
type EntityType = "product" | "customer" | "order" | "inventory" | "production";

export function useActivityLog() {
  const { user } = useAuth();

  const log = async (
    action: Action,
    entity_type: EntityType,
    entity_id: string,
    entity_name?: string,
    details?: Record<string, any>
  ) => {
    if (!user) return;
    try {
      // A IDENTIDADE NAO VAI MAIS DAQUI.
      //
      // Mandar `user_id`/`user_email`/`user_name` do navegador significava que
      // qualquer um podia gravar uma linha assinada com o nome de outra pessoa —
      // num log que so o admin le, ou seja, forja plantada exatamente onde ele
      // vai olhar. A migration 20260825340000 poe um gatilho que REESCREVE esses
      // tres campos a partir da sessao do servidor, entao mandar aqui seria, na
      // melhor das hipoteses, ruido.
      const { error } = await (supabase as any).from("activity_logs").insert({
        action,
        entity_type,
        entity_id,
        entity_name: entity_name ?? null,
        details:     details ?? null,
      });
      // O `error` E LIDO. Sem isto a trilha sumia CALADA: supabase-js resolve com
      // `{ error }` em falha de RLS ou de constraint — nao lanca —, entao o
      // `catch` abaixo so pegava queda de rede. A tela dizia "40 products
      // adjusted" e o Activity Logs mostrava "No logs found" no periodo, que e
      // indistinguivel de "ninguem fez nada".
      //
      // O risco concreto e de ORDEM DE DEPLOY: este arquivo parou de mandar
      // `user_id`/`user_email`/`user_name` (o gatilho de 20260825340000 os
      // reescreve a partir da sessao). Se o front subir antes daquele SQL, todo
      // insert e recusado pela policy antiga — em silencio, ate aqui.
      if (error) console.error("activity_logs: a acao NAO foi registrada.", error);
    } catch (e) {
      // Logging must never break the main flow — mas tambem nao pode sumir sem
      // deixar rastro para quem for investigar.
      console.error("activity_logs: falha ao registrar a acao.", e);
    }
  };

  return { log };
}
