import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// So os campos que este componente le. O `rpc` e `as any` (a RPC nao esta nos
// tipos gerados), entao o shape precisa ser declarado em algum lugar.
type ConfigStaff = {
  warehouse_popup_day?: number | null;
  warehouse_inactivity_popup?: number | null;
  warehouse_inactivity_default?: number | null;
};

const EVENTS = ["mousedown", "mousemove", "keypress", "scroll", "touchstart", "click"] as const;

const InactivityLogout = () => {
  const { role, signOut } = useAuth();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `signOut` NAO e memoizado: o `AuthProvider` o recria a cada render, e o
  // `value={{...}}` do contexto e um objeto novo junto. Com ele na lista de
  // dependencias, TODO refresh de token e TODA volta para a aba (o auth-js emite
  // `SIGNED_IN` em `_onVisibilityChanged`) reiniciava este efeito — e reiniciar no
  // meio da leitura assincrona abaixo era exatamente o que vazava listener.
  // Ref mantido atual: o timer sempre chama o `signOut` mais novo, e o efeito so
  // rearma quando o PAPEL muda.
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;

  useEffect(() => {
    if (role !== "warehouse") return;

    // A limpeza do React roda de forma SINCRONA; o `init` abaixo so termina
    // depois de uma ida ao servidor. Na versao anterior a limpeza lia uma
    // variavel `cleanup` que, nesse intervalo, ainda era `undefined`: ela nao
    // removia nada, e o `init` em voo instalava os listeners DEPOIS — pendurados
    // no `window` para sempre, com um `setTimeout` armado que chamava `signOut()`
    // num componente ja desmontado. Ou seja: logout surpresa de um usuario que
    // nem estava mais na tela do almoxarifado, e um conjunto de listeners a mais
    // a cada refresh de token.
    let cancelado = false;
    let soltar: (() => void) | undefined;

    const init = async () => {
      // Via RPC `config_staff` — a tabela virou admin-only (20260825290000).
      //
      // O `error` e LIDO. Sem isso, uma falha (RPC renomeada, RLS, rede) era
      // indistinguivel de "config vazia": o componente caia nos numeros chumbados
      // aqui e nada aparecia em lugar nenhum. Continua caindo nos defaults de
      // proposito — terminal de almoxarifado sem timer e pior que timer com o
      // numero errado — mas agora deixa rastro.
      //
      // O `try` existe porque uma excecao de rede aqui abortava o `init` inteiro:
      // nenhum listener, nenhum timer, e o usuario NUNCA mais era deslogado. A
      // falha na leitura da config nao pode desligar a protecao.
      let data: ConfigStaff | null = null;
      try {
        const { data: rows, error } = await (supabase as any).rpc("config_staff");
        if (error) console.error("[inactivity] config_staff falhou; usando defaults", error);
        else data = Array.isArray(rows) ? rows[0] : rows;
      } catch (e) {
        console.error("[inactivity] config_staff lancou; usando defaults", e);
      }
      if (cancelado) return;

      const popupDay       = data?.warehouse_popup_day          ?? 1;   // Monday
      const popupMinutes   = data?.warehouse_inactivity_popup   ?? 5;
      const defaultMinutes = data?.warehouse_inactivity_default ?? 480;

      const today = new Date().getDay();
      const minutes = today === popupDay ? popupMinutes : defaultMinutes;
      const timeoutMs = minutes * 60 * 1000;

      const reset = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(async () => {
          toast.warning("Session expired due to inactivity. Please log in again.");
          await signOutRef.current();
        }, timeoutMs);
      };

      EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
      reset(); // start timer

      soltar = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        EVENTS.forEach((e) => window.removeEventListener(e, reset));
      };
    };

    void init();

    return () => {
      cancelado = true;
      soltar?.();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [role]);

  return null;
};

export default InactivityLogout;
