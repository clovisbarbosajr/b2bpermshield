import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { CartProvider } from "@/contexts/CartContext";
import ProtectedRoute from "@/components/ProtectedRoute";

import Index from "./pages/Index";
import Login from "./pages/Login";
import LoginLanding from "./pages/LoginLanding";
import AdminLogin from "./pages/AdminLogin";
import CustomerLogin from "./pages/CustomerLogin";
import PendingApproval from "./pages/PendingApproval";
import ViewAsRedirect from "./pages/ViewAsRedirect";
import Cadastro from "./pages/Cadastro";
import RecuperarSenha from "./pages/RecuperarSenha";
import ResetPassword from "./pages/ResetPassword";
import PortalDashboard from "./pages/portal/Dashboard";
import Catalogo from "./pages/portal/Catalogo";
import Carrinho from "./pages/portal/Carrinho";
import ProdutoDetalhe from "./pages/portal/ProdutoDetalhe";
import Checkout from "./pages/portal/Checkout";
import Pedidos from "./pages/portal/Pedidos";
import PedidoDetalhe from "./pages/portal/PedidoDetalhe";
import Conta from "./pages/portal/Conta";
import NotFound from "./pages/NotFound";

// Admin pages
import AdminDashboard from "./pages/admin/Dashboard";
import AdminProdutos from "./pages/admin/Produtos";
import ProductEdit from "./pages/admin/ProductEdit";
import AdminCategorias from "./pages/admin/Categorias";
import AdminClientes from "./pages/admin/Clientes";
import CustomerEdit from "./pages/admin/CustomerEdit";
import AdminPedidos from "./pages/admin/Pedidos";
import OrderDetail from "./pages/admin/OrderDetail";
import AdminEstoque from "./pages/admin/Estoque";
import AdminTabelasPreco from "./pages/admin/TabelasPreco";
import AdminRelatorios from "./pages/admin/Relatorios";
import AdminConfiguracoes from "./pages/admin/Configuracoes";
import AdminNoticias from "./pages/admin/Noticias";
import AdminPaginas from "./pages/admin/Paginas";
import AdminRepresentantes from "./pages/admin/Representantes";
import AdminFerramentas from "./pages/admin/Ferramentas";
import AdminOptions from "./pages/admin/Options";
import AdminBrands from "./pages/admin/Brands";
import AdminProductImport from "./pages/admin/ProductImport";
import AdminProductExport from "./pages/admin/ProductExport";
import AdminBanners from "./pages/admin/Banners";

// Tools sub-pages
import PdfCatalog from "./pages/admin/tools/PdfCatalog";
import ImportCustomerPrices from "./pages/admin/tools/ImportCustomerPrices";
import ImportCustomers from "./pages/admin/tools/ImportCustomers";
import ImportAddresses from "./pages/admin/tools/ImportAddresses";
import ImportProductDiscounts from "./pages/admin/tools/ImportProductDiscounts";
import ImportProductVariants from "./pages/admin/tools/ImportProductVariants";
import ImportCategories from "./pages/admin/tools/ImportCategories";
import ImportOrders from "./pages/admin/tools/ImportOrders";
import BulkUpdateOrders from "./pages/admin/tools/BulkUpdateOrders";
import ImportsLog from "./pages/admin/tools/ImportsLog";
import ExportsLog from "./pages/admin/tools/ExportsLog";

// Reports sub-pages
import OrderRepsPerformance from "./pages/admin/reports/OrderRepsPerformance";
import CustomersPerformance from "./pages/admin/reports/CustomersPerformance";
import OrdersPerMonth from "./pages/admin/reports/OrdersPerMonth";
import ProductSales from "./pages/admin/reports/ProductSales";
import CustomerProductSales from "./pages/admin/reports/CustomerProductSales";
import ProductsByOrderStatus from "./pages/admin/reports/ProductsByOrderStatus";
import InventoryControl from "./pages/admin/reports/InventoryControl";
import SalesPerCategory from "./pages/admin/reports/SalesPerCategory";
import SalesPerProduct from "./pages/admin/reports/SalesPerProduct";
import OrdersSummary from "./pages/admin/reports/OrdersSummary";
import CustomerActivity from "./pages/admin/reports/CustomerActivity";
import OrderSummaryByStatus from "./pages/admin/reports/OrderSummaryByStatus";
import PaymentActivity from "./pages/admin/reports/PaymentActivity";

// Settings sub-pages
import SettingsProfile from "./pages/admin/settings/Profile";
import SetupApp from "./pages/admin/settings/SetupApp";
import PaymentOptions from "./pages/admin/settings/PaymentOptions";
import ShippingOptions from "./pages/admin/settings/ShippingOptions";
import EditPassword from "./pages/admin/settings/EditPassword";
import QuickLinks from "./pages/admin/settings/QuickLinks";
import ProductStatuses from "./pages/admin/settings/ProductStatuses";
import ProductStatusRules from "./pages/admin/settings/ProductStatusRules";
import PrivacyGroups from "./pages/admin/settings/PrivacyGroups";
import Coupons from "./pages/admin/settings/Coupons";
import SalesTax from "./pages/admin/settings/SalesTax";
import MeasurementUnit from "./pages/admin/settings/MeasurementUnit";
import CompanyActivities from "./pages/admin/settings/CompanyActivities";
import UsersManagement from "./pages/admin/settings/UsersManagement";
import ActivityLogs from "./pages/admin/settings/ActivityLogs";
import WarehouseSettings from "./pages/admin/settings/WarehouseSettings";
import EmailTemplates from "./pages/admin/settings/EmailTemplates";
import EmailSettings from "./pages/admin/settings/EmailSettings";
import ExtraFields from "./pages/admin/settings/ExtraFields";
import ApiKeys from "./pages/admin/settings/ApiKeys";
import B2BWaveSync from "./pages/admin/settings/B2BWaveSync";
import OauthApplications from "./pages/admin/settings/OauthApplications";

const queryClient = new QueryClient();

// Admin-only routes
const A = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute requiredRole="admin">{children}</ProtectedRoute>
);

// Any staff role: admin, manager, warehouse
const S = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute requiredRole="staff">{children}</ProtectedRoute>
);

// Legacy alias kept for compatibility
const AW = S;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <CartProvider>
            <Routes>
              <Route path="/" element={<LoginLanding />} />
              <Route path="/login" element={<LoginLanding />} />
              <Route path="/admin-login" element={<AdminLogin />} />
              <Route path="/customers-login" element={<CustomerLogin />} />
              <Route path="/view-as" element={<ViewAsRedirect />} />
              <Route path="/cadastro" element={<Cadastro />} />
              <Route path="/pending-approval" element={<PendingApproval />} />
              <Route path="/recuperar-senha" element={<RecuperarSenha />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* Customer Portal */}
              <Route path="/portal" element={<ProtectedRoute><PortalDashboard /></ProtectedRoute>} />
              <Route path="/portal/catalogo" element={<ProtectedRoute><Catalogo /></ProtectedRoute>} />
              <Route path="/portal/produto/:id" element={<ProtectedRoute><ProdutoDetalhe /></ProtectedRoute>} />
              <Route path="/portal/carrinho" element={<ProtectedRoute><Carrinho /></ProtectedRoute>} />
              <Route path="/portal/checkout" element={<ProtectedRoute><Checkout /></ProtectedRoute>} />
              <Route path="/portal/pedidos" element={<ProtectedRoute><Pedidos /></ProtectedRoute>} />
              <Route path="/portal/pedidos/:id" element={<ProtectedRoute><PedidoDetalhe /></ProtectedRoute>} />
              <Route path="/portal/conta" element={<ProtectedRoute><Conta /></ProtectedRoute>} />

              {/* Admin Panel — warehouse-accessible */}
              <Route path="/admin" element={<AW><AdminDashboard /></AW>} />
              <Route path="/admin/orders" element={<AW><AdminPedidos /></AW>} />
              <Route path="/admin/orders/:id" element={<AW><OrderDetail /></AW>} />
              <Route path="/admin/customers" element={<AW><AdminClientes /></AW>} />
              <Route path="/admin/customers/:id" element={<AW><CustomerEdit /></AW>} />
              <Route path="/admin/products" element={<AW><AdminProdutos /></AW>} />
              <Route path="/admin/products/new" element={<AW><ProductEdit /></AW>} />
              <Route path="/admin/products/:id" element={<AW><ProductEdit /></AW>} />
              <Route path="/admin/price-lists" element={<A><AdminTabelasPreco /></A>} />
              <Route path="/admin/options" element={<A><AdminOptions /></A>} />
              <Route path="/admin/brands" element={<A><AdminBrands /></A>} />
              <Route path="/admin/products/import" element={<AW><AdminProductImport /></AW>} />
              <Route path="/admin/products/export" element={<AW><AdminProductExport /></AW>} />
              <Route path="/admin/product-categories" element={<AW><AdminCategorias /></AW>} />
              <Route path="/admin/banners" element={<A><AdminBanners /></A>} />
              <Route path="/admin/news" element={<A><AdminNoticias /></A>} />
              <Route path="/admin/pages" element={<A><AdminPaginas /></A>} />
              <Route path="/admin/sales-reps" element={<A><AdminRepresentantes /></A>} />

              {/* Tools */}
              <Route path="/admin/tools/pdf-catalog" element={<A><PdfCatalog /></A>} />
              <Route path="/admin/tools/import-customer-prices" element={<A><ImportCustomerPrices /></A>} />
              <Route path="/admin/tools/import-customers" element={<A><ImportCustomers /></A>} />
              <Route path="/admin/tools/import-addresses" element={<A><ImportAddresses /></A>} />
              <Route path="/admin/tools/import-product-discounts" element={<A><ImportProductDiscounts /></A>} />
              <Route path="/admin/tools/import-product-variants" element={<A><ImportProductVariants /></A>} />
              <Route path="/admin/tools/import-categories" element={<A><ImportCategories /></A>} />
              <Route path="/admin/tools/import-orders" element={<A><ImportOrders /></A>} />
              <Route path="/admin/tools/bulk-update-orders" element={<A><BulkUpdateOrders /></A>} />
              <Route path="/admin/tools/imports-log" element={<A><ImportsLog /></A>} />
              <Route path="/admin/tools/exports-log" element={<A><ExportsLog /></A>} />

              {/* Reports */}
              <Route path="/admin/reports/order-reps-performance" element={<A><OrderRepsPerformance /></A>} />
              <Route path="/admin/reports/customers-performance" element={<A><CustomersPerformance /></A>} />
              <Route path="/admin/reports/orders-per-month" element={<A><OrdersPerMonth /></A>} />
              <Route path="/admin/reports/product-sales" element={<A><ProductSales /></A>} />
              <Route path="/admin/reports/customer-product-sales" element={<A><CustomerProductSales /></A>} />
              <Route path="/admin/reports/products-by-order-status" element={<A><ProductsByOrderStatus /></A>} />
              <Route path="/admin/reports/inventory-control" element={<A><InventoryControl /></A>} />
              <Route path="/admin/reports/sales-per-category" element={<A><SalesPerCategory /></A>} />
              <Route path="/admin/reports/sales-per-product" element={<A><SalesPerProduct /></A>} />
              <Route path="/admin/reports/orders-summary" element={<A><OrdersSummary /></A>} />
              <Route path="/admin/reports/customer-activity" element={<A><CustomerActivity /></A>} />
              <Route path="/admin/reports/order-summary-by-status" element={<A><OrderSummaryByStatus /></A>} />
              <Route path="/admin/reports/payment-activity" element={<A><PaymentActivity /></A>} />

              {/* Settings — admin-only */}
              <Route path="/admin/settings/setup-app" element={<A><SetupApp /></A>} />
              <Route path="/admin/settings/payment-options" element={<A><PaymentOptions /></A>} />
              <Route path="/admin/settings/shipping-options" element={<A><ShippingOptions /></A>} />
              <Route path="/admin/settings/quick-links" element={<A><QuickLinks /></A>} />
              <Route path="/admin/settings/product-statuses" element={<A><ProductStatuses /></A>} />
              <Route path="/admin/settings/product-status-rules" element={<A><ProductStatusRules /></A>} />
              <Route path="/admin/settings/privacy-groups" element={<A><PrivacyGroups /></A>} />
              <Route path="/admin/settings/coupons" element={<A><Coupons /></A>} />
              <Route path="/admin/settings/sales-tax" element={<A><SalesTax /></A>} />
              <Route path="/admin/settings/measurement-unit" element={<A><MeasurementUnit /></A>} />
              <Route path="/admin/settings/company-activities" element={<A><CompanyActivities /></A>} />
              <Route path="/admin/settings/extra-fields" element={<A><ExtraFields /></A>} />
              <Route path="/admin/settings/api-keys" element={<A><ApiKeys /></A>} />
              <Route path="/admin/settings/b2bwave-sync" element={<A><B2BWaveSync /></A>} />
              <Route path="/admin/settings/oauth-applications" element={<A><OauthApplications /></A>} />

              {/* Settings — staff with permission */}
              <Route path="/admin/settings/edit-password" element={<S><EditPassword /></S>} />
              <Route path="/admin/settings/profile" element={<S><SettingsProfile /></S>} />
              <Route path="/admin/settings/email" element={<S><EmailSettings /></S>} />
              <Route path="/admin/settings/email-templates" element={<S><EmailTemplates /></S>} />
              <Route path="/admin/settings/users" element={<S><UsersManagement /></S>} />
              <Route path="/admin/settings/warehouse" element={<S><WarehouseSettings /></S>} />
              <Route path="/admin/settings/activity-logs" element={<S><ActivityLogs /></S>} />

              {/* Legacy routes redirect */}
              <Route path="/admin/pedidos" element={<A><AdminPedidos /></A>} />
              <Route path="/admin/produtos" element={<A><AdminProdutos /></A>} />
              <Route path="/admin/categorias" element={<A><AdminCategorias /></A>} />
              <Route path="/admin/clientes" element={<A><AdminClientes /></A>} />
              <Route path="/admin/estoque" element={<A><AdminEstoque /></A>} />
              <Route path="/admin/tabelas-preco" element={<A><AdminTabelasPreco /></A>} />
              <Route path="/admin/relatorios" element={<A><AdminRelatorios /></A>} />
              <Route path="/admin/configuracoes" element={<A><AdminConfiguracoes /></A>} />
              <Route path="/admin/noticias" element={<A><AdminNoticias /></A>} />
              <Route path="/admin/paginas" element={<A><AdminPaginas /></A>} />
              <Route path="/admin/representantes" element={<A><AdminRepresentantes /></A>} />
              <Route path="/admin/ferramentas" element={<A><AdminFerramentas /></A>} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </CartProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
