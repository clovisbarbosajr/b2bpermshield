import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const EVENTS = ["mousedown", "mousemove", "keypress", "scroll", "touchstart", "click"] as const;

const InactivityLogout = () => {
  const { role, signOut } = useAuth();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (role !== "warehouse") return;

    let timeoutMs = 8 * 60 * 60 * 1000; // default 8h in ms

    const init = async () => {
      // Fetch inactivity settings from DB
      const { data } = await (supabase as any)
        .from("configuracoes")
        .select("warehouse_popup_day, warehouse_inactivity_popup, warehouse_inactivity_default")
        .limit(1)
        .maybeSingle();

      const popupDay      = data?.warehouse_popup_day          ?? 1;   // Monday
      const popupMinutes  = data?.warehouse_inactivity_popup   ?? 5;
      const defaultMinutes = data?.warehouse_inactivity_default ?? 480;

      const today = new Date().getDay();
      const minutes = today === popupDay ? popupMinutes : defaultMinutes;
      timeoutMs = minutes * 60 * 1000;

      const reset = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(async () => {
          toast.warning("Session expired due to inactivity. Please log in again.");
          await signOut();
        }, timeoutMs);
      };

      EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
      reset(); // start timer

      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        EVENTS.forEach((e) => window.removeEventListener(e, reset));
      };
    };

    let cleanup: (() => void) | undefined;
    init().then((fn) => { cleanup = fn; });

    return () => {
      if (cleanup) cleanup();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [role, signOut]);

  return null;
};

export default InactivityLogout;
