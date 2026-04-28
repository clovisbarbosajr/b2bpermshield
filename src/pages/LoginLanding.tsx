import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import adminBg from "@/assets/adminportal.jpg";
import customerBg from "@/assets/customers.jpg";

const LoginLanding = () => {
  const { user, role, loading } = useAuth();

  // While auth is loading, show the landing page normally (no blank screen)
  // Once loaded, if user is authenticated redirect them to the right place
  if (!loading && user) {
    if (role === "admin" || role === "manager" || role === "warehouse") {
      return <Navigate to="/admin" replace />;
    }
    if (role === "cliente") {
      return <Navigate to="/portal" replace />;
    }
    // role is null → pending approval
    return <Navigate to="/pending-approval" replace />;
  }

  return (
    <div
      className="relative min-h-screen w-full flex flex-col overflow-hidden"
      style={{
        background: 'linear-gradient(to bottom, #fff 0%, #fff 40%, rgba(255,255,255,0) 100%), linear-gradient(to right, #0ed2da, #5f29c7)',
      }}
    >
      {/* Grid lines overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(90deg, rgba(180,180,180,0.25) 1px, transparent 1px)',
          backgroundSize: '30px 100%',
          maskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 70%)',
          WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 70%)',
        }}
      />

      {/* Main content */}
      <div className="relative z-10 flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-4xl flex flex-col items-center">
          {/* Title */}
          <div className="flex flex-col items-center gap-5 mb-10 sm:mb-14">
            <div className="flex items-center gap-4">
              <div className="h-px w-10 sm:w-16 bg-gradient-to-r from-transparent to-[#5f29c7]/30" />
              <h1
                className="text-xl sm:text-3xl md:text-4xl font-extrabold tracking-[0.18em] uppercase whitespace-nowrap"
                style={{
                  color: '#1a1a2e',
                  textShadow: '0 2px 12px rgba(95, 41, 199, 0.15), 0 1px 3px rgba(0,0,0,0.1)',
                }}
              >
                B2B Management System
              </h1>
              <div className="h-px w-10 sm:w-16 bg-gradient-to-l from-transparent to-[#0ed2da]/30" />
            </div>
            <p className="text-[#1a1a2e]/50 text-xs sm:text-sm tracking-widest uppercase">
              Select your login portal
            </p>
          </div>

          {/* Portal Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6 w-full max-w-3xl">
            {/* Admin Card */}
            <Link
              to="/admin-login"
              className="group relative rounded-2xl overflow-hidden h-56 sm:h-64 border border-black/10 hover:border-[#5f29c7]/30 shadow-xl shadow-black/10 hover:shadow-[#5f29c7]/15 transition-all duration-500 hover:scale-[1.02]"
            >
              <img
                src={adminBg}
                alt="Administrator Login"
                className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-55 transition-opacity duration-500 scale-105 group-hover:scale-100"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#1a1a2e] via-[#1a1a2e]/60 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-br from-[#5f29c7]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              
              <div className="relative z-10 flex flex-col items-center justify-end h-full p-6 pb-7">
                <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center mb-4 group-hover:bg-[#5f29c7]/20 group-hover:border-[#0ed2da]/40 transition-all duration-300">
                  <svg className="w-6 h-6 text-[#0ed2da]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-white uppercase tracking-wider mb-1">
                  Administrator
                </h2>
                <p className="text-white/40 text-xs">Access the admin dashboard</p>
                <div className="mt-3 flex items-center gap-1.5 text-[#0ed2da]/0 group-hover:text-[#0ed2da]/80 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
                  <span className="text-[10px] font-semibold tracking-widest uppercase">Enter</span>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>

            {/* Customer Card */}
            <Link
              to="/customers-login"
              className="group relative rounded-2xl overflow-hidden h-56 sm:h-64 border border-black/10 hover:border-[#0ed2da]/30 shadow-xl shadow-black/10 hover:shadow-[#0ed2da]/15 transition-all duration-500 hover:scale-[1.02]"
            >
              <img
                src={customerBg}
                alt="Customers Login"
                className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-55 transition-opacity duration-500 scale-105 group-hover:scale-100"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#1a1a2e] via-[#1a1a2e]/60 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-br from-[#0ed2da]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              
              <div className="relative z-10 flex flex-col items-center justify-end h-full p-6 pb-7">
                <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center mb-4 group-hover:bg-[#0ed2da]/20 group-hover:border-[#0ed2da]/40 transition-all duration-300">
                  <svg className="w-6 h-6 text-[#0ed2da]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-white uppercase tracking-wider mb-1">
                  Customers
                </h2>
                <p className="text-white/40 text-xs">Access the customer portal</p>
                <div className="mt-3 flex items-center gap-1.5 text-[#0ed2da]/0 group-hover:text-[#0ed2da]/80 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
                  <span className="text-[10px] font-semibold tracking-widest uppercase">Enter</span>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="relative z-10 w-full border-t border-black/5 bg-[#1a1a2e]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center sm:text-left">
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-widest text-[#0ed2da]/60 mb-2">About</h4>
              <p className="text-[11px] text-white/30 leading-relaxed">
                Durable, versatile, waterproof Vinyl Flooring without compromising your style or imagination.
              </p>
            </div>
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-widest text-[#0ed2da]/60 mb-2">Contact</h4>
              <address className="text-[11px] text-white/30 not-italic leading-relaxed">
                1800 N Powerline Rd Ste A6<br />Pompano Beach, FL 33069
              </address>
            </div>
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-widest text-[#0ed2da]/60 mb-2">Social</h4>
              <div className="flex items-center justify-center sm:justify-start gap-4">
                <a href="https://www.facebook.com/permshield" target="_blank" rel="noopener noreferrer" className="text-white/25 hover:text-[#0ed2da]/70 transition-colors">
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                </a>
                <a href="https://www.instagram.com/permshield/" target="_blank" rel="noopener noreferrer" className="text-white/25 hover:text-[#0ed2da]/70 transition-colors">
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                </a>
                <a href="https://www.pinterest.com/permshield/" target="_blank" rel="noopener noreferrer" className="text-white/25 hover:text-[#0ed2da]/70 transition-colors">
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12.017 24c6.624 0 11.99-5.367 11.99-11.988C24.007 5.367 18.641 0 12.017 0z"/></svg>
                </a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LoginLanding;
