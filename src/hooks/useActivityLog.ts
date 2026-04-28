import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Action = "created" | "updated" | "deleted";
type EntityType = "product" | "customer" | "order";

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
      await (supabase as any).from("activity_logs").insert({
        user_id:     user.id,
        user_email:  user.email ?? null,
        user_name:   user.user_metadata?.nome ?? user.email ?? null,
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
