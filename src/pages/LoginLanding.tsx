import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePortalTheme, usePortalMotion } from "@/hooks/usePortalTheme";

const LoginLanding = () => {
  const { user, role, loading } = useAuth();

  usePortalTheme(["portal-page"]);
  usePortalMotion();

  // REDIRECIONAMENTO INTACTO na migracao do desenho (26/ago). Sem ele, quem ja
  // esta logado cai na tela de ESCOLHA em vez do proprio painel — e o desenho
  // estatico entregue nao tinha nocao de sessao nenhuma.
  //
  // Fica DEPOIS dos hooks de proposito: hook nao pode ficar atras de `return`
  // condicional, ou a ordem muda entre renders e o React quebra.
  if (!loading && user) {
    if (role === "admin" || role === "manager" || role === "warehouse") {
      return <Navigate to="/admin" replace />;
    }
    if (role === "cliente") {
      return <Navigate to="/portal" replace />;
    }
    // role nulo -> aguardando aprovacao
    return <Navigate to="/pending-approval" replace />;
  }

  return (
    <>
      <div className="ambient" aria-hidden="true"><i /><i /><i /></div>

      <header className="topbar">
        <Link className="brand" to="/" aria-label="PermShield B2B home">
          <img src="/portal-tema/assets/permshield-logo.png" alt="PermShield Luxury Vinyl Flooring" />
        </Link>
        <div className="topbar__meta">
          <span className="live-dot" /> BUSINESS NETWORK <b>/</b> SECURE ACCESS
        </div>
        <a className="support-link" href="mailto:info@permshield.com">
          Need assistance? <strong>Contact us ↗</strong>
        </a>
      </header>

      <main className="portal-layout">
        <section className="portal-copy">
          <div className="section-code"><span>PS</span> B2B / 2026</div>
          <p className="overline">THE BUSINESS BEHIND BEAUTIFUL SPACES</p>
          <h1>Move business<br /><em>forward.</em></h1>
          <p className="hero-text">
            A focused workspace for orders, customer relationships, inventory visibility, and the
            teams building with PermShield every day.
          </p>
          <div className="proof-row" aria-label="Platform benefits">
            <span><b>01</b> One connected workflow</span>
            <span><b>02</b> Real-time order clarity</span>
            <span><b>03</b> Built for every partner</span>
          </div>
        </section>

        <section className="portal-visual" data-parallax aria-label="PermShield showroom">
          <div className="showroom-photo" />
          <div className="visual-shade" />
          <div className="floor-axis" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <div className="material-chip material-chip--one">
            <small>COLLECTION / 01</small><strong>PISMO DUNES</strong><span>PREMIUM SPC</span>
          </div>
          <div className="material-chip material-chip--two">
            <small>PERFORMANCE</small><strong>100%</strong><span>WATERPROOF</span>
          </div>
          <div className="visual-caption">
            <span>PERMSHIELD SHOWROOM</span><i /><span>POMPANO BEACH, FL</span>
          </div>
        </section>

        <section className="portal-selector" aria-labelledby="portal-choice">
          <div className="selector-heading">
            <p id="portal-choice">Choose your workspace</p>
            <span>SELECT ACCESS LEVEL <b>↘</b></span>
          </div>
          <div className="portal-cards">
            <Link className="portal-card portal-card--customer" to="/customers-login">
              <span className="card-index">01</span>
              <div className="card-icon" aria-hidden="true">
                <svg viewBox="0 0 48 48">
                  <path d="M9 37c2-7 7-10 15-10s13 3 15 10M24 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
                </svg>
              </div>
              <div>
                <p>PARTNER ACCESS</p>
                <h2>Customer<br />Workspace</h2>
                <span>Orders, account tools and resources</span>
              </div>
              <b className="card-arrow">ENTER <i>↗</i></b>
            </Link>

            <Link className="portal-card portal-card--admin" to="/admin-login">
              <span className="card-index">02</span>
              <div className="card-icon" aria-hidden="true">
                <svg viewBox="0 0 48 48">
                  <path d="M24 4 40 10v12c0 11-7 18-16 22C15 40 8 33 8 22V10l16-6Z" />
                  <path d="m17 24 5 5 10-11" />
                </svg>
              </div>
              <div>
                <p>INTERNAL ACCESS</p>
                <h2>Admin<br />Control</h2>
                <span>Operations, customers and oversight</span>
              </div>
              <b className="card-arrow">ENTER <i>↗</i></b>
            </Link>
          </div>
        </section>
      </main>

      <footer className="portal-footer">
        <span>© <b>{new Date().getFullYear()}</b> PERMSHIELD</span>
        <span>WATERPROOF <i /> KID PROOF <i /> PET PROOF</span>
        {/* As redes sociais estavam no rodape antigo e o desenho novo nao as
            previa. Mantidas: tirar canal de contato do cliente numa troca de
            visual e perda silenciosa, nao decisao de design. */}
        <span className="portal-social">
          <a href="https://www.facebook.com/permshield" target="_blank" rel="noreferrer noopener">Facebook</a>
          <a href="https://www.instagram.com/permshield/" target="_blank" rel="noreferrer noopener">Instagram</a>
          <a href="https://www.pinterest.com/permshield/" target="_blank" rel="noreferrer noopener">Pinterest</a>
        </span>
        <span>1800 N POWERLINE RD, POMPANO BEACH</span>
      </footer>
    </>
  );
};

export default LoginLanding;
