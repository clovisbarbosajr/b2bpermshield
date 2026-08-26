import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePortalTheme, usePortalMotion } from "@/hooks/usePortalTheme";


// Sinal de recuperacao capturado no CARREGAMENTO DO MODULO, nao dentro do
// efeito.
//
// O supabase-js consome os tokens do fragmento da URL e LIMPA o hash assim que o
// cliente e criado — o que pode acontecer antes de o componente montar. Se a
// checagem so existisse dentro do `useEffect`, o link legitimo as vezes chegaria
// com o hash ja vazio e o cliente de verdade ficaria trancado do lado de fora.
//
// Ler aqui em cima acontece na importacao do modulo, junto com o resto do
// bundle, e o valor fica guardado.
const VEIO_DE_RECUPERACAO = (() => {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash || "";
  const query = window.location.search || "";
  return /(^|[#&?])type=recovery(&|$)/.test(hash)
      || /(^|[#&?])type=recovery(&|$)/.test(query)
      || hash.includes("recovery_token");
})();

const ResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [verSenha, setVerSenha] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  usePortalTheme(["auth-page", "auth-page--customer"]);
  usePortalMotion();

  // DAQUI ATE O `navigate` NADA foi alterado na migracao do desenho (26/ago).
  // E a trava de seguranca desta tela, e ela ja teve um defeito grave descrito
  // logo abaixo. Trocar visual nao e motivo para reescrever isto.
  useEffect(() => {
    // Listen for the PASSWORD_RECOVERY event from Supabase
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
        setChecking(false);
      }
    });

    // Sinal capturado no topo do modulo (ver comentario la em cima): aqui o hash
    // ja pode ter sido limpo pelo supabase-js.
    if (VEIO_DE_RECUPERACAO) {
      setReady(true);
      setChecking(false);
    }

    // ANTES ESTAVA ERRADO AQUI: `if (session) setReady(true)` — QUALQUER sessao
    // liberava o formulario de troca de senha, nao so a de recuperacao.
    //
    // Isso promove uma sessao TEMPORARIA em senha PERMANENTE. O link de acesso
    // por e-mail (publico) entrega uma sessao completa a quem tiver acesso a
    // caixa: e-mail encaminhado, caixa compartilhada de compras@, computador de
    // balcao com sessao aberta. Bastava abrir /reset-password e fixar a senha.
    // E era o caminho de escalada de qualquer XSS no dominio.
    //
    // Agora so libera com sinal explicito de recuperacao: o evento
    // PASSWORD_RECOVERY, ou o `type=recovery` capturado no topo do modulo.
    if (VEIO_DE_RECUPERACAO) {
      setReady(true);
    }
    setChecking(false);

    // Timeout: if nothing detected after 3 seconds, show invalid link
    const timeout = setTimeout(() => {
      setChecking(false);
    }, 3000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setAviso(null);
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      setAviso("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      setAviso("The two passwords do not match.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      setAviso(error.message);
    } else {
      toast.success("Password updated successfully!");
      // Sign out so user logs in with new password
      await supabase.auth.signOut();
      navigate("/customers-login");
    }
  };

  // A CASCA e a mesma nos tres estados: so o miolo do cartao muda. Assim o
  // cliente que caiu num link vencido ve a mesma tela, e nao um erro pelado que
  // parece outro site.
  const casca = (titulo: string, subtitulo: string, miolo: React.ReactNode) => (
    <>
      <div className="cursor-glow" aria-hidden="true" />

      <header className="topbar topbar--auth">
        <Link className="brand" to="/">
          <img src="/paginas/assets/permshield-logo.png" alt="PermShield Luxury Vinyl Flooring" />
        </Link>
        <div className="topbar__meta">
          <span className="live-dot" /> ACCOUNT RECOVERY / SECURE SESSION
        </div>
        <Link className="back-top" to="/customers-login">← Back to login</Link>
      </header>

      <main className="auth-layout">
        <section className="auth-story auth-story--customer" data-parallax>
          <div className="showroom-photo" />
          <div className="story-overlay" />
          <div className="story-copy">
            <p className="overline">ACCOUNT RECOVERY / 03</p>
            <h1>Reset access.<br /><em>Keep moving.</em></h1>
            <p>Choose a new password for the e-mail address connected to your PermShield account.</p>
            <div className="story-metrics">
              <span><b>01</b> ENTER EMAIL</span>
              <span><b>02</b> CHECK INBOX</span>
              <span><b>03</b> CREATE PASSWORD</span>
            </div>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-card auth-card--customer">
            <div className="auth-card__head"><span>RESET PASSWORD</span><b>03</b></div>
            <div className="auth-intro">
              <small>SECURE RECOVERY</small>
              <h2>{titulo}</h2>
              <p>{subtitulo}</p>
            </div>
            {miolo}
            <Link className="back-link" to="/customers-login">← Back to customer login</Link>
          </div>
          <p className="security-note"><i /> Secure account recovery · Your session is protected</p>
        </section>
      </main>
    </>
  );

  if (checking) {
    return casca("Verifying…", "Please wait while we check your reset link.", null);
  }

  if (!ready) {
    return casca(
      "This link is no longer valid.",
      "Reset links expire for your safety. Ask for a new one from the login screen and it arrives in your inbox.",
      <p className="form-status is-error" aria-live="polite">
        This reset link is invalid or has expired.
      </p>,
    );
  }

  return casca(
    "Choose a new password.",
    "At least 8 characters. You will sign in with it right after.",
    <form className="auth-form" onSubmit={handleUpdate} noValidate>
      <label htmlFor="password">New password</label>
      <div className="auth-field">
        <span className="field-icon">◆</span>
        <input
          id="password"
          type={verSenha ? "text" : "password"}
          autoComplete="new-password"
          placeholder="Enter your new password"
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

      <label htmlFor="confirmPassword">Confirm new password</label>
      <div className="auth-field">
        <span className="field-icon">◆</span>
        <input
          id="confirmPassword"
          type={verSenha ? "text" : "password"}
          autoComplete="new-password"
          placeholder="Repeat your new password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
      </div>

      <button className="primary-button" type="submit" disabled={loading}>
        <span>{loading ? "Updating…" : "Update password"}</span><b>↗</b>
      </button>

      <p className={`form-status${aviso ? " is-error" : ""}`} aria-live="polite">
        {aviso ?? ""}
      </p>
    </form>,
  );
};

export default ResetPassword;
