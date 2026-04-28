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

  const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // Validate caller is admin
    const authHeader = req.headers.get("authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify the calling user is an admin
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return json({ error: "Not authenticated" }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return json({ error: "Only admins can create users" }, 403);
    }

    // Parse request body
    const body = await req.json();
    const { action, email, password, nome, empresa, user_ids, user_id: targetUserId, new_password } = body;

    // ── Action: list staff users by IDs ────────────────────────────────────────
    if (action === "list_staff") {
      if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
        return json({ users: [] });
      }
      const { data: listData, error: listError } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
      if (listError) return json({ error: listError.message }, 500);
      const matched = (listData?.users ?? [])
        .filter((u: any) => user_ids.includes(u.id))
        .map((u: any) => ({
          id:              u.id,
          email:           u.email ?? "",
          nome:            u.user_metadata?.nome ?? null,
          created_at:      u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
        }));
      return json({ users: matched });
    }

    // ── Action: reset / update password ────────────────────────────────────────
    if (action === "update_password") {
      if (!targetUserId || !new_password || new_password.length < 6) {
        return json({ error: "user_id and new_password (min 6 chars) required" }, 400);
      }
      const { error: upErr } = await adminClient.auth.admin.updateUserById(targetUserId, {
        password: new_password,
      });
      if (upErr) return json({ error: upErr.message }, 400);
      return json({ success: true });
    }

    // ── Default action: create user ─────────────────────────────────────────────
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return json({ error: "Valid email is required" }, 400);
    }

    // Create auth user with service role (bypasses email confirmation)
    const createPayload: any = {
      email,
      email_confirm: true,
      user_metadata: { nome: nome || "", empresa: empresa || "" },
    };

    // If admin provided a password, use it. Otherwise user will need to reset.
    if (password && password.length >= 6) {
      createPayload.password = password;
    }

    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser(createPayload);

    if (createError) {
      return json({ error: createError.message }, 400);
    }

    if (!newUser?.user) {
      return json({ error: "Failed to create user" }, 500);
    }

    const userId = newUser.user.id;

    return json({
      user_id: userId,
      email: newUser.user.email,
      message: "Auth user created successfully",
    });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});
