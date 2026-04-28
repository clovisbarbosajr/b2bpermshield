import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Missing backend configuration" }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const nome = String(body?.nome ?? "").trim();
    const existingUserId = typeof body?.existing_user_id === "string" ? body.existing_user_id.trim() : "";

    if (!email || !email.includes("@")) {
      return json({ error: "Valid email is required" }, 400);
    }

    if (!password || password.length < 6) {
      return json({ error: "Password must be at least 6 characters" }, 400);
    }

    if (!nome) {
      return json({ error: "Nome is required" }, 400);
    }

    if (existingUserId) {
      const { error: deleteRoleError } = await adminClient
        .from("user_roles")
        .delete()
        .eq("user_id", existingUserId);

      if (deleteRoleError) {
        return json({ error: deleteRoleError.message }, 500);
      }

      const { error: deleteProfileError } = await adminClient
        .from("profiles")
        .delete()
        .or(`user_id.eq.${existingUserId},email.eq.${email}`);

      if (deleteProfileError) {
        return json({ error: deleteProfileError.message }, 500);
      }

      const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(existingUserId);
      if (deleteUserError) {
        return json({ error: deleteUserError.message }, 500);
      }
    }

    const { data: createdUserData, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome },
    });

    if (createError || !createdUserData.user) {
      return json({ error: createError?.message ?? "Failed to create user" }, 500);
    }

    const { error: roleError } = await adminClient
      .from("user_roles")
      .upsert({ user_id: createdUserData.user.id, role: "admin" }, { onConflict: "user_id" });

    if (roleError) {
      return json({ error: roleError.message }, 500);
    }

    return json({
      id: createdUserData.user.id,
      email: createdUserData.user.email,
      email_confirmed_at: createdUserData.user.email_confirmed_at,
      role: "admin",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});