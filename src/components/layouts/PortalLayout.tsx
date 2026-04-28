import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "react-router-dom";
import { ShoppingCart, Package, ClipboardList, User, Home, LogOut, Shield, Menu, ChevronRight, FileText } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useCart } from "@/contexts/CartContext";

import ViewAsBanner from "@/components/ViewAsBanner";

type Categoria = { id: string; nome: string; parent_id: string | null; ordem: number };

const navItems = [
  { to: "/portal", icon: Home, label: "Dashboard" },
  { to: "/portal/catalogo", icon: Package, label: "Catalog" },
  { to: "/portal/carrinho", icon: ShoppingCart, label: "Cart" },
  { to: "/portal/pedidos", icon: ClipboardList, label: "Orders" },
  { to: "/portal/conta", icon: User, label: "My Account" },
];

const PortalLayout = ({ children }: { children: React.ReactNode }) => {
  const { user, signOut, impersonatedCustomer } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [catalogPdfUrl, setCatalogPdfUrl] = useState<string | null>(null);
  const { items, total } = useCart();

  useEffect(() => {
    const fetch = async () => {
      const [{ data: cats }, { data: cfg }] = await Promise.all([
        supabase.from("categorias").select("id, nome, parent_id, ordem").eq("ativo", true).order("ordem").order("nome"),
        (supabase.from("configuracoes") as any).select("catalog_pdf_url").limit(1).maybeSingle(),
      ]);
      setCategorias((cats as Categoria[]) ?? []);
      setCatalogPdfUrl(cfg?.catalog_pdf_url ?? null);
    };
    fetch();
  }, []);

  const rootCats = categorias.filter(c => !c.parent_id);
  const childrenOf = (parentId: string) => categorias.filter(c => c.parent_id === parentId);

  const toggleExpand = (id: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const isCatalogPage = location.pathname.includes("/catalogo") || location.pathname.includes("/produto/");

  const renderCatItem = (cat: Categoria) => {
    const children = childrenOf(cat.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedCats.has(cat.id);

    return (
      <div key={cat.id}>
        <div className="flex items-center border-b border-border/30">
          <Link
            to={`/portal/catalogo?category=${cat.id}`}
            className={cn(
              "flex-1 px-4 py-3 text-sm hover:text-primary transition-colors",
              location.search.includes(cat.id) && "text-primary font-medium"
            )}
          >
            {cat.nome}
          </Link>
          {hasChildren && (
            <button
              onClick={() => toggleExpand(cat.id)}
              className="px-3 py-3 hover:text-primary transition-colors"
            >
              <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-90")} />
            </button>
          )}
        </div>
        {hasChildren && isExpanded && (
          <div className="pl-4 bg-muted/20">
            {children.map(child => renderCatItem(child))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-6">
          <Shield className="h-7 w-7 text-sidebar-primary" />
          <span className="font-display text-lg font-bold text-sidebar-primary-foreground">PermShield</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "sidebar-nav-main flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
                {item.to === "/portal/carrinho" && items.length > 0 && (
                  <span className="ml-auto text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5">{items.length}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-4 shrink-0">
          <p className="mb-2 truncate text-xs text-sidebar-foreground/60">{user?.email}</p>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={signOut}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-foreground/20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="flex flex-1 flex-col">
        {/* View As Banner */}
        <ViewAsBanner />

        {/* Top header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b bg-card px-4 lg:px-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="font-display text-lg font-semibold text-foreground">{impersonatedCustomer?.empresa || impersonatedCustomer?.nome || "B2B Portal"}</h1>
          </div>
          <div className="flex items-center gap-4">
            {items.length > 0 && (
              <Link to="/portal/carrinho" className="flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium">
                <span>ORDER TOTAL</span>
                <span className="font-bold">${total.toFixed(2)}</span>
                <ChevronRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </header>

        <main className="flex-1 flex">

          {/* Category Sidebar (only on catalog/product pages) */}
          {isCatalogPage && categorias.length > 0 && (
            <aside className="hidden lg:block w-64 shrink-0 p-4">
              <div className="bg-card rounded-lg border overflow-hidden">
                {rootCats.map(cat => renderCatItem(cat))}
                {catalogPdfUrl ? (
                  <a
                    href={catalogPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-muted/80 text-sm font-semibold hover:bg-muted transition-colors"
                  >
                    <FileText className="h-4 w-4" /> PDF CATALOG
                  </a>
                ) : (
                  <span className="flex items-center justify-center gap-2 px-4 py-3 bg-muted/50 text-sm font-semibold text-muted-foreground cursor-not-allowed">
                    <FileText className="h-4 w-4" /> PDF CATALOG
                  </span>
                )}
              </div>
            </aside>
          )}

          {/* Content */}
          <div className="flex-1 p-4 lg:p-6 animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default PortalLayout;
