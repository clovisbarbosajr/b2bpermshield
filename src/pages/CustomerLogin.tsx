import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ForgotPasswordModal from "@/components/login/ForgotPasswordModal";
import MagicLinkModal from "@/components/login/MagicLinkModal";
import { usePortalTheme, usePortalMotion } from "@/hooks/usePortalTheme";

const CustomerLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [verSenha, setVerSenha] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showMagicLink, setShowMagicLink] = useState(false);

  usePortalTheme(["auth-page", "auth-page--customer"]);
  usePortalMotion();

  // Autenticacao INTACTA na migracao do desenho (26/ago).
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAviso(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      setAviso(error.message);
      return;
    }
    navigate("/portal");
  };

  return (
    <>
      <div className="cursor-glow" aria-hidden="true" />

      <header className="topbar topbar--auth">
        <Link className="brand" to="/">
          <img src="/paginas/assets/permshield-logo.png" alt="PermShield Luxury Vinyl Flooring" />
        </Link>
        <div className="topbar__meta">
          <span className="live-dot" /> PARTNER ACCESS / SECURE SESSION
        </div>
        <Link className="back-top" to="/">← Back to portal</Link>
      </header>

      <main className="auth-layout">
        <section className="auth-story auth-story--customer" data-parallax>
          <div className="story-grid" aria-hidden="true" />
          <div className="story-copy">
            <p className="overline">PARTNER WORKSPACE / 01</p>
            <h1>Everything your<br /><em>account touches.</em></h1>
            <p>Orders, pricing, documents and support — in one place, always current.</p>
            <div className="system-status">
              <span><i /> SYSTEMS OPERATIONAL</span><b>SECURE SESSION</b>
            </div>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-card">
            <div className="auth-card__head"><span>CUSTOMER ACCESS</span><b>01</b></div>
            <div className="auth-intro">
              <small>PARTNER WORKSPACE</small>
              <h2>Welcome back.</h2>
              <p>Sign in to reach your orders and account tools.</p>
            </div>

            <form className="auth-form" onSubmit={handleLogin} noValidate>
              {/* Rotulo "E-mail", nao "Username": quem autentica e
                  `signInWithPassword({ email })`. O desenho estatico dizia
                  Username, e um rotulo que nao bate com o campo faz o cliente
                  digitar outra coisa e culpar a senha. */}
              <label htmlFor="customer-user">E-mail</label>
              <div className="auth-field">
                <span className="field-icon">⌁</span>
                <input
                  id="customer-user"
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="Enter your e-mail"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="label-row">
                <label htmlFor="customer-password">Password</label>
                {/* Abre a JANELA de recuperacao, que e o fluxo que existe e
                    funciona. O desenho estatico apontava para
                    `reset-password.html`, que e a tela de DEFINIR senha nova
                    (chegada por link de e-mail) — nao a de pedir o link. */}
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                >
                  Forgot password?
                </button>
              </div>
              <div className="auth-field">
                <span className="field-icon">◆</span>
                <input
                  id="customer-password"
                  name="password"
                  type={verSenha ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  className="password-toggle"
                  type="button"
                  onClick={() => setVerSenha((v) => !v)}
                  aria-label={verSenha ? "Hide password" : "Show password"}
                >
                  {verSenha ? "HIDE" : "SHOW"}
                </button>
              </div>

              <button className="magic-link" type="button" onClick={() => setShowMagicLink(true)}>
                <span>ONE-TIME LOGIN LINK</span><b>✦</b>
              </button>

              <button className="primary-button" type="submit" disabled={loading}>
                <span>{loading ? "Signing in…" : "Log in"}</span><b>↗</b>
              </button>

              <Link className="secondary-button" to="/cadastro">
                <span>Sign up</span><b>＋</b>
              </Link>

              <p className={`form-status${aviso ? " is-error" : ""}`} aria-live="polite">
                {aviso ?? ""}
              </p>
            </form>

            <Link className="back-link" to="/">← Back to login selection</Link>
          </div>
          <p className="security-note"><i /> Secure partner access · Your session is protected</p>
        </section>
      </main>

      <ForgotPasswordModal open={showForgotPassword} onClose={() => setShowForgotPassword(false)} />
      <MagicLinkModal open={showMagicLink} onClose={() => setShowMagicLink(false)} />
    </>
  );
};

export default CustomerLogin;
