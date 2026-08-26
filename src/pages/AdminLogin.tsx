import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePortalTheme, usePortalMotion } from "@/hooks/usePortalTheme";

const AdminLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [verSenha, setVerSenha] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);

  usePortalTheme(["auth-page", "auth-page--admin"]);
  usePortalMotion();

  // ATENCAO: daqui para baixo, ate o `navigate`, NADA foi alterado na migracao
  // do desenho novo (26/ago). E a autenticacao inteira desta tela — login,
  // conferencia de papel e a expulsao de quem nao e staff. O desenho estatico
  // que o dono entregou tinha `action="#"` e nao autenticava ninguem; trocar
  // isto por aquilo teria virado uma tela bonita que nao deixa ninguem entrar.
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAviso(null);
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      setAviso({ tipo: "erro", texto: error.message });
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
        setAviso({ tipo: "erro", texto: "This account does not have administrator access." });
        return;
      }
    }
    navigate("/admin");
  };

  return (
    <>
      <div className="cursor-glow" aria-hidden="true" />

      <header className="topbar topbar--auth">
        <Link className="brand" to="/">
          <img src="/paginas/assets/permshield-logo.png" alt="PermShield Luxury Vinyl Flooring" />
        </Link>
        <div className="topbar__meta">
          <span className="live-dot" /> ADMINISTRATION / AUTHORIZED PERSONNEL
        </div>
        <Link className="back-top" to="/">← Back to portal</Link>
      </header>

      <main className="auth-layout">
        <section className="auth-story auth-story--admin" data-parallax>
          <div className="story-grid" aria-hidden="true" />
          <div className="shield-system" aria-hidden="true">
            <svg viewBox="0 0 500 560">
              <path className="shield-ring ring-a" d="M250 22 445 92v151c0 142-87 231-195 285C142 474 55 385 55 243V92l195-70Z" />
              <path className="shield-ring ring-b" d="M250 90 378 136v99c0 93-57 152-128 187-71-35-128-94-128-187v-99l128-46Z" />
              <path className="shield-check" d="m176 249 49 51 105-123" />
            </svg>
            <div className="orbit-label label-a">ACCESS</div>
            <div className="orbit-label label-b">CONTROL</div>
            <div className="orbit-label label-c">VERIFIED</div>
          </div>
          <div className="story-copy">
            <p className="overline">OPERATIONS CONTROL / 02</p>
            <h1>Command the<br /><em>whole floor.</em></h1>
            <p>One secure entry point for the people coordinating inventory, customers, and every order in motion.</p>
            <div className="system-status">
              <span><i /> SYSTEMS OPERATIONAL</span><b>256-BIT SESSION</b>
            </div>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-card">
            <div className="auth-card__head"><span>ADMIN ACCESS</span><b>02</b></div>
            <div className="auth-intro">
              <small>SECURE WORKSPACE</small>
              <h2>Welcome back.</h2>
              <p>Sign in with your authorized PermShield credentials.</p>
            </div>

            <form className="auth-form" onSubmit={handleLogin} noValidate>
              {/* `email`, nao `username`: o desenho estatico rotulava "Username",
                  mas quem autentica e `signInWithPassword({ email })`. Rotulo
                  que nao corresponde ao campo faz o cliente digitar a coisa
                  errada e culpar a senha. */}
              <label htmlFor="admin-user">E-mail</label>
              <div className="auth-field">
                <span className="field-icon">⌁</span>
                <input
                  id="admin-user"
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="Enter your e-mail"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <label htmlFor="admin-password">Password</label>
              <div className="auth-field">
                <span className="field-icon">◆</span>
                <input
                  id="admin-password"
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

              <button className="primary-button" type="submit" disabled={loading}>
                <span>{loading ? "Signing in…" : "Enter control center"}</span><b>↗</b>
              </button>

              <p className={`form-status${aviso ? (aviso.tipo === "erro" ? " is-error" : " is-success") : ""}`} aria-live="polite">
                {aviso?.texto ?? ""}
              </p>
            </form>

            <Link className="back-link" to="/">← Back to login selection</Link>
          </div>
          <p className="security-note"><i /> Protected access · Activity may be monitored</p>
        </section>
      </main>
    </>
  );
};

export default AdminLogin;
