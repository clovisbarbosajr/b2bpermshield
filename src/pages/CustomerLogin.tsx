import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import customerBg from "@/assets/customers.jpg";
import BackgroundGradient from "@/components/ui/background-gradient-snippet";
import ForgotPasswordModal from "@/components/login/ForgotPasswordModal";
import MagicLinkModal from "@/components/login/MagicLinkModal";

const CustomerLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showMagicLink, setShowMagicLink] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate("/portal");
  };

  return (
    <div className="relative min-h-screen min-h-[100dvh] w-full overflow-hidden bg-[#0a0f1e]">
      {/* Desktop: background image */}
      <div className="absolute inset-0 hidden sm:block">
        <img
          src={customerBg}
          alt=""
          aria-hidden
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none select-none"
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
          className="mx-auto flex w-full max-w-[360px] flex-col items-center gap-2.5 rounded-xl border border-white/10 bg-[#0b1628]/70 p-5 shadow-xl shadow-black/30 backdrop-blur-sm sm:translate-y-[14vh] md:translate-y-[12vh] lg:translate-y-[10vh]"
        >
          <div className="relative w-full">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4fc3f7] opacity-70">
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="USERNAME"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-white/20 bg-white/10 py-3 pl-8 pr-3 text-xs font-semibold tracking-widest text-white placeholder:uppercase placeholder-white/50 backdrop-blur-sm transition-all focus:bg-white/15 focus:border-[#4fc3f7]/60 focus:outline-none"
            />
          </div>

          <div className="relative w-full">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4fc3f7] opacity-70">
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3.1-9H8.9V6a3.1 3.1 0 0 1 6.2 0v2z" />
              </svg>
            </span>
            <input
              type="password"
              placeholder="PASSWORD"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-white/20 bg-white/10 py-3 pl-8 pr-3 text-xs font-semibold tracking-widest text-white placeholder:uppercase placeholder-white/50 backdrop-blur-sm transition-all focus:bg-white/15 focus:border-[#4fc3f7]/60 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowForgotPassword(true)}
            className="mb-0 -mt-1 self-end text-[9px] uppercase tracking-wider text-white/40 transition-colors hover:text-white/70"
          >
            Forgot Password?
          </button>

          <button
            type="button"
            onClick={() => setShowMagicLink(true)}
            className="text-[10px] font-semibold uppercase tracking-wider text-white/50 transition-colors hover:text-[#4fc3f7]"
          >
            One-Time Login Link ✨
          </button>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-[#1a7fbd] py-3 text-sm font-bold uppercase tracking-widest text-white shadow-lg shadow-[#1a7fbd]/30 transition-all hover:bg-[#1a9fdd] active:bg-[#1580c0] disabled:opacity-50"
          >
            {loading ? "..." : "LOG IN"}
          </button>

          <Link
            to="/cadastro"
            className="w-full rounded border-2 border-[#1a5fa0] bg-[#1a3a6a]/60 py-3 text-center text-sm font-bold uppercase tracking-widest text-white transition-all hover:bg-[#1a5fa0]/80 active:bg-[#1a5fa0]"
          >
            SIGN UP
          </Link>

          <Link
            to="/"
            className="py-2 text-[10px] tracking-wide text-white/30 transition-colors hover:text-white/60"
          >
            ← Back to login selection
          </Link>
        </form>
      </div>

      <ForgotPasswordModal
        open={showForgotPassword}
        onClose={() => setShowForgotPassword(false)}
      />
      <MagicLinkModal
        open={showMagicLink}
        onClose={() => setShowMagicLink(false)}
      />
    </div>
  );
};

export default CustomerLogin;
