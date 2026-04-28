import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import adminBg from "@/assets/adminportal.jpg";
import BackgroundGradient from "@/components/ui/background-gradient-snippet";

const AdminLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data.user) {
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (roleData?.role !== "admin" && (roleData?.role as string) !== "warehouse" && (roleData?.role as string) !== "manager") {
        await supabase.auth.signOut();
        toast.error("This account does not have administrator access.");
        return;
      }
    }
    navigate("/admin");
  };

  return (
    <div className="relative min-h-screen min-h-[100dvh] w-full overflow-hidden bg-[#0a0f1e]">
      <div className="absolute inset-0 hidden sm:block">
        <img
          src={adminBg}
          alt=""
          aria-hidden
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-center pointer-events-none select-none"
        />
        <div className="absolute inset-0 bg-[#0a0f1e]/30 pointer-events-none" />
      </div>

      {/* Mobile: gradient background */}
      <div className="absolute inset-0 sm:hidden">
        <BackgroundGradient />
      </div>

      {/* Form */}
      <div className="relative z-10 flex min-h-screen min-h-[100dvh] items-center justify-center px-4">
        <form
          onSubmit={handleLogin}
          className="mx-auto flex w-full max-w-[360px] flex-col items-center gap-3 rounded-xl border border-white/10 bg-[#0b1628]/70 p-5 shadow-xl shadow-black/30 backdrop-blur-sm sm:translate-y-[10vh] md:translate-y-[8vh] lg:translate-y-[7vh]"
        >
          <div className="relative w-full">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4fc3f7] opacity-70">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="USERNAME"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-white/20 bg-white/10 py-3 pl-9 pr-4 text-sm font-semibold tracking-widest text-white placeholder:uppercase placeholder-white/50 backdrop-blur-sm transition-all focus:bg-white/15 focus:border-[#4fc3f7]/60 focus:outline-none"
            />
          </div>

          <div className="relative w-full">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4fc3f7] opacity-70">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3.1-9H8.9V6a3.1 3.1 0 0 1 6.2 0v2z" />
              </svg>
            </span>
            <input
              type="password"
              placeholder="PASSWORD"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-white/20 bg-white/10 py-3 pl-9 pr-4 text-sm font-semibold tracking-widest text-white placeholder:uppercase placeholder-white/50 backdrop-blur-sm transition-all focus:bg-white/15 focus:border-[#4fc3f7]/60 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-[#1a7fbd] py-3 text-sm font-bold uppercase tracking-widest text-white shadow-lg shadow-[#1a7fbd]/30 transition-all hover:bg-[#1a9fdd] active:bg-[#1580c0] disabled:opacity-50"
          >
            {loading ? "..." : "LOGIN"}
          </button>

          <Link
            to="/"
            className="mt-1 py-2 text-xs tracking-wide text-white/40 transition-colors hover:text-white/70"
          >
            ← Back
          </Link>
        </form>
      </div>
    </div>
  );
};

export default AdminLogin;
