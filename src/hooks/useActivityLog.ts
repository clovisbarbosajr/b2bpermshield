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
      await (supabase as any).from("activity_logs").insert({
        action,
        entity_type,
        entity_id,
        entity_name: entity_name ?? null,
        details:     details ?? null,
      });
    } catch {
      // Logging must never break the main flow
    }
  };

  return { log };
}
