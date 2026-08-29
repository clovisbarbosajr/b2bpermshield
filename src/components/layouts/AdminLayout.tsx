import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "react-router-dom";
import {
  Package, Users, ClipboardList, FolderTree, Home, LogOut, Shield, Menu,
  DollarSign, BarChart3, Settings, Newspaper, FileText, UserCheck, Wrench,
  ChevronDown, Image, SlidersHorizontal, Tag, Upload, Download, FileDown,
  FileUp, ListOrdered, UserCog, CreditCard, Truck, Lock, Link2, Layers,
  Percent, Receipt, Ruler, Building2, UserPlus, Mail, Database,
  Activity, ShoppingCart, TrendingUp, PieChart, PackageSearch, CalendarRange,
  LayoutGrid, ScrollText, ClipboardCheck, RefreshCw, ClipboardSignature, Bell, History, Factory
} from "lucide-react";
import { useState, createContext, useContext } from "react";

// Marca que já estamos dentro do shell persistente do admin (layout via <Outlet/>).
// Quando uma PÁGINA renderiza <AdminLayout> dentro do shell, ele só passa o conteúdo
// adiante (não duplica a sidebar) — assim a sidebar NÃO remonta ao trocar de aba.
const AdminShellContext = createContext(false);
export const useInsideAdminShell = () => useContext(AdminShellContext);
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import MondayPopup from "@/components/warehouse/MondayPopup";
import InactivityLogout from "@/components/warehouse/InactivityLogout";

type NavItem = {
  to: string;
  icon: React.ElementType;
  label: string;
};

type NavGroup = {
  label: string;
  icon: React.ElementType;
  children: NavItem[];
};

type NavEntry = NavItem | NavGroup;

const isGroup = (entry: NavEntry): entry is NavGroup => "children" in entry;

// ============================================================================
// ITENS OCULTOS DO MENU (2026-06-18) — NÃO removidos, apenas comentados.
// Motivo: enquanto migramos pro fluxo de sync (B2BWave), não vamos usar estas
// telas manualmente. As ROTAS (App.tsx) e as TELAS continuam 100% funcionais e
// acessíveis por URL — só não aparecem no menu. Para reativar: descomente a linha.
// Documentação completa em MENU_OCULTO.md.
// Ocultos:
//   Settings → Setup App            (/admin/settings/setup-app)
//   Banners                         (/admin/banners)
//   News                            (/admin/news)
//   Pages                           (/admin/pages)
//   Tools → Import Customer Prices  (/admin/tools/import-customer-prices)
//   Tools → Import Customers        (/admin/tools/import-customers)
//   Tools → Import Addresses        (/admin/tools/import-addresses)
//   Tools → Import Product Variants (/admin/tools/import-product-variants)
//   Tools → Import Categories       (/admin/tools/import-categories)
//   Tools → Import Orders           (/admin/tools/import-orders)
//   Tools → Bulk Update Orders      (/admin/tools/bulk-update-orders)
//   Tools → Imports Log             (/admin/tools/imports-log)
//   Tools → Exports Log             (/admin/tools/exports-log)
//   Products → Import               (/admin/products/import)
//   Products → Export               (/admin/products/export)
// MANTIDOS visíveis: Tools → PDF Catalog.
// REMOVIDO em 28/ago/2026: Import Product Discounts. A ferramenta gravava
// `desconto` em `tabela_preco_itens` e em `produtos`, coluna que nao existe em
// nenhuma das duas — toda linha voltava PGRST204 e ela NUNCA importou um
// desconto sequer. E a Jess confirmou que o recurso de desconto esta sendo
// desativado no B2BWave, entao consertar seria consertar para ninguem usar.
// ============================================================================
const adminNavEntries: NavEntry[] = [
  { to: "/admin", icon: Home, label: "Dashboard" },
  { to: "/admin/orders", icon: ClipboardList, label: "Orders" },
  { to: "/admin/customers", icon: Users, label: "Customers" },
  {
    label: "Products", icon: Package,
    children: [
      { to: "/admin/products", icon: Package, label: "Products" },
      { to: "/admin/price-lists", icon: DollarSign, label: "Price Lists" },
      { to: "/admin/options", icon: SlidersHorizontal, label: "Options" },
      { to: "/admin/brands", icon: Tag, label: "Brands" },
      // OCULTOS (rotas/telas intactas — ver MENU_OCULTO.md):
      // { to: "/admin/products/import", icon: Upload, label: "Import" },
      // { to: "/admin/products/export", icon: Download, label: "Export" },
    ],
  },
  { to: "/admin/product-categories", icon: FolderTree, label: "Product Categories" },
  {
    label: "Production", icon: Factory,
    children: [
      { to: "/admin/producao/entrada", icon: Package, label: "New Entry" },
      { to: "/admin/producao/status", icon: ClipboardList, label: "Status" },
      { to: "/admin/producao/dashboard", icon: LayoutGrid, label: "Dashboard" },
      { to: "/admin/estoque/adjustment", icon: Package, label: "Inventory Adjustment" },
    ],
  },
  {
    label: "Tools", icon: Wrench,
    children: [
      // REMOVIDO DO MENU em 25/ago/2026: a tela SEMPRE da erro.
      //
      // Ela chama `generate-pdf` com `{ type: "catalog", categories, price_list_id,
      // statuses, ... }`, e a funcao so aceita `pedido_id` — responde
      // `400 pedido_id is required` e a tela mostra "Error: ...". Nunca gerou
      // catalogo nenhum.
      //
      // Sao DUAS falhas encadeadas: mesmo que a funcao aceitasse, a tela espera
      // `data.html` e a funcao devolve `{ pdf_base64, filename }` — o
      // `window.open` seria pulado em silencio e ainda assim apareceria
      // "Catalog generated!".
      //
      // PARA VOLTAR: descomente ISTO **e** crie o ramo `type === "catalog"` em
      // `supabase/functions/generate-pdf/index.ts`, que hoje so sabe montar PDF
      // de um pedido. Sem as duas pontas, volta a ser um botao que so erra.
      // { to: "/admin/tools/pdf-catalog", icon: FileDown, label: "PDF Catalog" },
      { to: "/admin/tools/import-related-products", icon: Package, label: "Import Related Products" },
      // OCULTOS (rotas/telas intactas — ver MENU_OCULTO.md):
      // { to: "/admin/tools/import-customer-prices", icon: DollarSign, label: "Import Customer Prices" },
      // { to: "/admin/tools/import-customers", icon: UserPlus, label: "Import Customers" },
      // { to: "/admin/tools/import-addresses", icon: FileUp, label: "Import Addresses" },
      // { to: "/admin/tools/import-product-variants", icon: Layers, label: "Import Product Variants" },
      // { to: "/admin/tools/import-categories", icon: FolderTree, label: "Import Categories" },
      // { to: "/admin/tools/import-orders", icon: ClipboardList, label: "Import Orders" },
      // { to: "/admin/tools/bulk-update-orders", icon: ClipboardCheck, label: "Bulk Update Orders" },
      // { to: "/admin/tools/imports-log", icon: ScrollText, label: "Imports Log" },
      // { to: "/admin/tools/exports-log", icon: ScrollText, label: "Exports Log" },
    ],
  },
  // OCULTOS (rotas/telas intactas — ver MENU_OCULTO.md):
  // { to: "/admin/banners", icon: Image, label: "Banners" },
  // { to: "/admin/news", icon: Newspaper, label: "News" },
  // { to: "/admin/pages", icon: FileText, label: "Pages" },
  { to: "/admin/sales-reps", icon: UserCheck, label: "Sales Reps" },
  {
    label: "Reports", icon: BarChart3,
    children: [
      { to: "/admin/reports/order-reps-performance", icon: UserCheck, label: "Order Reps Performance" },
      { to: "/admin/reports/customers-performance", icon: Users, label: "Customers Performance" },
      { to: "/admin/reports/orders-per-month", icon: CalendarRange, label: "Orders per Month" },
      { to: "/admin/reports/product-sales", icon: TrendingUp, label: "Product Sales" },
      { to: "/admin/reports/customer-product-sales", icon: ShoppingCart, label: "Customer Product Sales" },
      { to: "/admin/reports/products-by-order-status", icon: PackageSearch, label: "Products by Order Status" },
      { to: "/admin/reports/inventory-control", icon: Database, label: "Inventory Control" },
      { to: "/admin/reports/sales-per-category", icon: PieChart, label: "Sales per Category per Month" },
      { to: "/admin/reports/sales-per-product", icon: BarChart3, label: "Sales per Product per Month" },
      { to: "/admin/reports/orders-summary", icon: ListOrdered, label: "Orders Summary" },
      { to: "/admin/reports/customer-activity", icon: Activity, label: "Customer Activity" },
      { to: "/admin/reports/order-summary-by-status", icon: LayoutGrid, label: "Order Summary by Status Change" },
      { to: "/admin/reports/payment-activity", icon: CreditCard, label: "Payment Activity" },
    ],
  },
  {
    label: "Settings", icon: Settings,
    children: [
      { to: "/admin/settings/profile", icon: UserCog, label: "Profile" },
      // OCULTO (rota/tela intacta — ver MENU_OCULTO.md):
      // { to: "/admin/settings/setup-app", icon: Settings, label: "Setup App" },
      { to: "/admin/settings/payment-options", icon: CreditCard, label: "Payment Options" },
      { to: "/admin/settings/shipping-options", icon: Truck, label: "Shipping Options" },
      { to: "/admin/settings/edit-password", icon: Lock, label: "Edit Password" },
      { to: "/admin/settings/quick-links", icon: Link2, label: "Quick Links" },
      { to: "/admin/settings/product-statuses", icon: Layers, label: "Product Statuses" },
      { to: "/admin/settings/product-status-rules", icon: ListOrdered, label: "Product Status Rules" },
      { to: "/admin/settings/privacy-groups", icon: Shield, label: "Privacy Groups" },
      { to: "/admin/settings/coupons", icon: Percent, label: "Coupons" },
      { to: "/admin/settings/sales-tax", icon: Receipt, label: "Sales Tax" },
      { to: "/admin/settings/measurement-unit", icon: Ruler, label: "Measurement Unit" },
      { to: "/admin/settings/company-activities", icon: Building2, label: "Company Activities" },
      { to: "/admin/settings/users", icon: Users, label: "Users" },
      { to: "/admin/settings/warehouse", icon: Package, label: "Warehouse Settings" },
      { to: "/admin/settings/activity-logs", icon: ClipboardSignature, label: "Activity Logs" },
      { to: "/admin/settings/notifications", icon: Bell, label: "Notifications" },
      { to: "/admin/settings/notifications-log", icon: History, label: "Notifications Log" },
      // REMOVIDOS em 28/ago/2026: "Oauth Applications" e "API Keys".
      //
      // As duas rotas foram comentadas no `App.tsx` em 25/ago porque as telas nao
      // faziam nada — a chave `bj_...` da tela de API nao autentica coisa alguma (a
      // edge `api` compara com `configuracoes.api_token`), e nao existe endpoint
      // OAuth no sistema. Mas o comentario de la afirmava "ja estava fora do menu",
      // e nao estava: os dois itens continuavam aqui, levando a rota inexistente.
      // Quem clicasse caia no 404 sem entender por que.
      { to: "/admin/settings/extra-fields", icon: Database, label: "Extra Fields" },
      { to: "/admin/settings/b2bwave-sync", icon: RefreshCw, label: "B2B Wave Sync" },
    ],
  },
];

// Build dynamic nav for manager/warehouse based on their permissions
function buildStaffNav(hasPermission: (key: string) => boolean): NavEntry[] {
  const entries: NavEntry[] = [];

  if (hasPermission("view_dashboard")) {
    entries.push({ to: "/admin", icon: Home, label: "Dashboard" });
  }
  if (hasPermission("view_orders")) {
    entries.push({ to: "/admin/orders", icon: ClipboardList, label: "Orders" });
  }
  if (hasPermission("view_customers")) {
    entries.push({ to: "/admin/customers", icon: Users, label: "Customers" });
  }
  if (hasPermission("view_products")) {
    entries.push({
      label: "Products", icon: Package,
      children: [
        { to: "/admin/products", icon: Package, label: "Products" },
        // OCULTOS (rotas/telas intactas — ver MENU_OCULTO.md):
        // { to: "/admin/products/import", icon: Upload, label: "Import" },
        // { to: "/admin/products/export", icon: Download, label: "Export" },
      ],
    });
    entries.push({ to: "/admin/product-categories", icon: FolderTree, label: "Product Categories" });
    // Warehouse/manager: produção + ajuste de estoque em massa (logado no Activity Logs).
    entries.push({
      label: "Production", icon: Factory,
      children: [
        { to: "/admin/producao/entrada", icon: Package, label: "New Entry" },
        { to: "/admin/producao/status", icon: ClipboardList, label: "Status" },
        { to: "/admin/producao/dashboard", icon: LayoutGrid, label: "Dashboard" },
        { to: "/admin/estoque/adjustment", icon: Package, label: "Inventory Adjustment" },
      ],
    });
  }

  const settingsChildren: NavItem[] = [];
  // Change password is always available
  settingsChildren.push({ to: "/admin/settings/edit-password", icon: Lock, label: "Change Password" });
  if (hasPermission("view_profile_settings")) {
    settingsChildren.push({ to: "/admin/settings/profile", icon: UserCog, label: "Profile" });
  }
  if (hasPermission("view_warehouse_settings")) {
    settingsChildren.push({ to: "/admin/settings/warehouse", icon: Package, label: "Warehouse Settings" });
  }
  if (hasPermission("view_users_management")) {
    settingsChildren.push({ to: "/admin/settings/users", icon: Users, label: "Users" });
  }
  if (hasPermission("view_activity_logs")) {
    settingsChildren.push({ to: "/admin/settings/activity-logs", icon: ClipboardSignature, label: "Activity Logs" });
  }

  entries.push({ label: "Settings", icon: Settings, children: settingsChildren });

  return entries;
}

const ROLE_BADGE: Record<string, { label: string; className: string }> = {
  admin:     { label: "Admin",     className: "bg-primary/20 text-primary" },
  manager:   { label: "Manager",   className: "bg-purple-500/20 text-purple-400" },
  warehouse: { label: "Warehouse", className: "bg-amber-500/20 text-amber-400" },
};

const AdminLayout = ({ children }: { children: React.ReactNode }) => {
  const insideShell = useInsideAdminShell();
  const { user, role, hasPermission, signOut } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navEntries = role === "admin"
    ? adminNavEntries
    : buildStaffNav(hasPermission);

  const badge = ROLE_BADGE[role ?? ""] ?? ROLE_BADGE["admin"];

  const isChildActive = (group: NavGroup) =>
    group.children.some((c) => location.pathname === c.to);

  // Já dentro do shell persistente → só renderiza o conteúdo (a sidebar/header já existem).
  if (insideShell) return <>{children}</>;

  return (
    <AdminShellContext.Provider value={true}>
    <div className="flex min-h-screen">
      {/* Warehouse-only features: Monday popup + inactivity logout */}
      {role === "warehouse" && <MondayPopup />}
      {role === "warehouse" && <InactivityLogout />}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-6">
          <Shield className="h-7 w-7 text-sidebar-primary" />
          <div>
            <span className="font-display text-lg font-bold text-sidebar-primary-foreground">PermShield</span>
            <span className={cn("ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", badge.className)}>
              {badge.label}
            </span>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {navEntries.map((entry, idx) => {
            if (isGroup(entry)) {
              const active = isChildActive(entry);
              return (
                <Collapsible key={idx} defaultOpen={active}>
                  <CollapsibleTrigger className={cn(
                    "sidebar-nav-main flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active ? "text-sidebar-primary" : "text-sidebar-foreground"
                  )}>
                    <span className="flex items-center gap-3">
                      <entry.icon className="h-4 w-4" />
                      {entry.label}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 transition-transform [[data-state=open]>&]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-4 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-3">
                      {entry.children.map((child) => {
                        const isActive = location.pathname === child.to;
                        return (
                          <Link
                            key={child.to}
                            to={child.to}
                            onClick={() => setSidebarOpen(false)}
                            className={cn(
                              "sidebar-nav-sub flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-all",
                              isActive ? "font-medium text-sidebar-primary" : "text-sidebar-foreground"
                            )}
                          >
                            {child.label}
                          </Link>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            }

            const isActive = location.pathname === entry.to;
            return (
              <Link
                key={entry.to}
                to={entry.to}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "sidebar-nav-main flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-sidebar-accent text-sidebar-primary" : "text-sidebar-foreground"
                )}
              >
                <entry.icon className="h-4 w-4" />
                {entry.label}
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

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-foreground/20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-card px-4 lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
        </header>
        <main className="flex-1 p-4 lg:p-6 animate-fade-in">
          {children}
        </main>
      </div>
    </div>
    </AdminShellContext.Provider>
  );
};

export default AdminLayout;
