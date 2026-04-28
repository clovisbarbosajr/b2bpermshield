import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import loginBg from "@/assets/login-bg.jpg";

const LogoWordmark = ({ className = "" }: { className?: string }) => (
  <div className={`font-display text-foreground font-extrabold tracking-[0.18em] uppercase ${className}`}>
    PermShield
  </div>
);

const AppInput = ({ placeholder, type = "text", value, onChange }: { placeholder: string; type?: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) => {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div className="relative w-full">
      <input
        type={type}
        className="peer relative z-10 border-2 border-border h-13 w-full rounded-md bg-card px-4 font-thin outline-none drop-shadow-sm transition-all duration-200 ease-in-out focus:bg-background placeholder:font-medium placeholder:text-muted-foreground text-foreground"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      />
      {isHovering && (
        <>
          <div
            className="absolute pointer-events-none top-0 left-0 right-0 h-[2px] z-20 rounded-t-md overflow-hidden"
            style={{ background: `radial-gradient(30px circle at ${mousePosition.x}px 0px, hsl(var(--accent)) 0%, transparent 70%)` }}
          />
          <div
            className="absolute pointer-events-none bottom-0 left-0 right-0 h-[2px] z-20 rounded-b-md overflow-hidden"
            style={{ background: `radial-gradient(30px circle at ${mousePosition.x}px 2px, hsl(var(--accent)) 0%, transparent 70%)` }}
          />
        </>
      )}
    </div>
  );
};

const Login = () => {
  const navigate = useNavigate();
  const { loginAsDemo } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    const emailLower = email.trim().toLowerCase();
    if (emailLower === "admin") {
      loginAsDemo("admin");
      navigate("/admin");
      return;
    }
    if (emailLower === "user") {
      loginAsDemo("cliente");
      navigate("/portal");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      navigate("/");
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div className="min-h-screen w-full flex flex-col bg-background">
      <div className="flex-1 flex items-center justify-center p-4 relative z-10">
        <div className="rounded-xl border border-border shadow-2xl w-full max-w-[95%] sm:max-w-[90%] lg:max-w-[70%] flex flex-col lg:flex-row justify-between min-h-[480px] lg:h-[600px] overflow-hidden bg-card">
          <div
            className="w-full lg:w-1/2 px-6 sm:px-10 lg:px-16 h-full relative overflow-hidden"
            onMouseMove={handleMouseMove}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            <div
              className={`absolute pointer-events-none w-[500px] h-[500px] bg-gradient-to-r from-accent/20 via-primary/20 to-accent/10 rounded-full blur-3xl transition-opacity duration-200 ${
                isHovering ? "opacity-100" : "opacity-0"
              }`}
              style={{
                transform: `translate(${mousePosition.x - 250}px, ${mousePosition.y - 250}px)`,
                transition: "transform 0.1s ease-out",
              }}
            />
            <form className="text-center py-8 md:py-12 flex flex-col gap-4 h-full relative z-10" onSubmit={handleLogin}>
              <div className="flex flex-col items-center gap-3 mb-2">
                <LogoWordmark className="text-lg sm:text-xl" />
                <h1 className="text-2xl sm:text-3xl font-extrabold font-display text-foreground">Sign In</h1>
              </div>
              <div className="flex flex-col gap-4 flex-1 justify-center">
                <AppInput placeholder="Email" type="text" value={email} onChange={(e) => setEmail(e.target.value)} />
                <AppInput placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <p className="text-xs text-muted-foreground/60">
                  Demo: type <span className="font-semibold text-accent">admin</span> or <span className="font-semibold text-accent">user</span> as email and press Sign In
                </p>
              </div>
              <Link to="/recuperar-senha" className="font-light text-sm text-muted-foreground hover:text-accent transition-colors uppercase tracking-wide">
                Forgot password?
              </Link>
              <div className="flex gap-4 justify-center items-center">
                <button
                  type="submit"
                  disabled={loading}
                  className="group/button relative inline-flex justify-center items-center overflow-hidden rounded-md bg-accent w-full max-w-[280px] py-3 text-sm font-semibold uppercase tracking-wider text-accent-foreground transition-all duration-300 ease-in-out hover:scale-105 hover:shadow-lg hover:shadow-accent/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="relative z-10">{loading ? "Signing in..." : "Log In"}</span>
                  <div className="absolute inset-0 flex h-full w-full justify-center [transform:skew(-13deg)_translateX(-100%)] group-hover/button:duration-1000 group-hover/button:[transform:skew(-13deg)_translateX(100%)]">
                    <div className="relative h-full w-8 bg-white/20" />
                  </div>
                </button>
              </div>
              <Link to="/cadastro" className="inline-flex justify-center items-center rounded-md border-2 border-primary w-full max-w-[280px] mx-auto py-3 text-sm font-semibold uppercase tracking-wider text-primary-foreground bg-primary hover:bg-primary/90 transition-colors">
                Sign Up
              </Link>
            </form>
          </div>

          <div className="hidden lg:block w-1/2 h-full overflow-hidden relative">
            <img
              src={loginBg}
              alt="Industrial background"
              className="w-full h-full object-cover opacity-30"
            />
            <div className="absolute inset-0 bg-primary/40" />
          </div>
        </div>
      </div>

      <footer className="w-full border-t border-border bg-card/80 backdrop-blur-sm relative z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="flex items-start">
              <LogoWordmark className="text-sm" />
            </div>

            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wider text-accent mb-3">About</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Durable, versatile, waterproof Vinyl Flooring without compromising your style or imagination.
              </p>
            </div>

            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wider text-accent mb-3">Contact Us</h4>
              <address className="text-sm text-muted-foreground not-italic leading-relaxed">
                1800 N Powerline Rd Ste A6<br />
                POMPANO BEACH FL 33069<br />
                United States
              </address>
            </div>

            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wider text-accent mb-3">Keep in Touch</h4>
              <div className="flex flex-col gap-2">
                <a href="https://www.facebook.com/permshield" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors">
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                  Facebook
                </a>
                <a href="https://www.instagram.com/permshield/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors">
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                  Instagram
                </a>
                <a href="https://www.pinterest.com/permshield/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors">
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12.017 24c6.624 0 11.99-5.367 11.99-11.988C24.007 5.367 18.641 0 12.017 0z"/></svg>
                  Pinterest
                </a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Login;
