import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Outlet, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { CartProvider } from "@/contexts/CartContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminLayout from "@/components/layouts/AdminLayout";
import ScrollToTop from "@/components/ScrollToTop";

import Index from "./pages/Index";
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
import PortalTeam from "./pages/portal/Team";
import ProducaoEntrada from "./pages/admin/producao/ProducaoEntrada";
import ProducaoStatus from "./pages/admin/producao/ProducaoStatus";
import ProducaoDashboard from "./pages/admin/producao/ProducaoDashboard";
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
import InventoryAdjustment from "./pages/admin/InventoryAdjustment";
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
// import PdfCatalog from "./pages/admin/tools/PdfCatalog";  // rota comentada abaixo
import ImportCustomerPrices from "./pages/admin/tools/ImportCustomerPrices";
import ImportCustomers from "./pages/admin/tools/ImportCustomers";
import ImportAddresses from "./pages/admin/tools/ImportAddresses";
import ImportProductDiscounts from "./pages/admin/tools/ImportProductDiscounts";
import ImportRelatedProducts from "./pages/admin/tools/ImportRelatedProducts";
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
// import QuickLinks from "./pages/admin/settings/QuickLinks";  // rota comentada abaixo
import ProductStatuses from "./pages/admin/settings/ProductStatuses";
import ProductStatusRules from "./pages/admin/settings/ProductStatusRules";
import PrivacyGroups from "./pages/admin/settings/PrivacyGroups";
import Coupons from "./pages/admin/settings/Coupons";
import SalesTax from "./pages/admin/settings/SalesTax";
// import MeasurementUnit from "./pages/admin/settings/MeasurementUnit";  // rota comentada abaixo
import CompanyActivities from "./pages/admin/settings/CompanyActivities";
import UsersManagement from "./pages/admin/settings/UsersManagement";
import ActivityLogs from "./pages/admin/settings/ActivityLogs";
import WarehouseSettings from "./pages/admin/settings/WarehouseSettings";
import EmailSettings from "./pages/admin/settings/EmailSettings";
import Notificacoes from "./pages/admin/settings/Notificacoes";
import NotificacoesLog from "./pages/admin/settings/NotificacoesLog";
// import ExtraFields from "./pages/admin/settings/ExtraFields";  // rota comentada abaixo
// import ApiKeys from "./pages/admin/settings/ApiKeys";  // rota comentada abaixo
import B2BWaveSync from "./pages/admin/settings/B2BWaveSync";
// import OauthApplications from "./pages/admin/settings/OauthApplications";  // rota comentada abaixo
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

// Staff + permissão específica: bloqueia o papel que não tem a permissão (ex.: warehouse
// não vê Users/Profile). Manager (sub-admin) passa pelas que tem por padrão.
const SP = ({ perm, children }: { perm: string; children: React.ReactNode }) => (
  <ProtectedRoute requiredRole="staff" requiredPermission={perm}>{children}</ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <CartProvider>
            <ScrollToTop />
            <Routes>
              <Route path="/" element={<LoginLanding />} />
              <Route path="/login" element={<CustomerLogin />} />
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
              <Route path="/portal/team" element={<ProtectedRoute><PortalTeam /></ProtectedRoute>} />

              {/* Admin Panel — UM shell persistente (sidebar/header não remontam ao trocar de aba).
                  As páginas continuam renderizando <AdminLayout>, que vira passthrough quando aninhado. */}
              <Route element={<S><AdminLayout><Outlet /></AdminLayout></S>}>
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

              {/* Produção */}
              <Route path="/admin/producao/entrada" element={<AW><ProducaoEntrada /></AW>} />
              <Route path="/admin/producao/status" element={<AW><ProducaoStatus /></AW>} />
              <Route path="/admin/producao/dashboard" element={<AW><ProducaoDashboard /></AW>} />

              {/* Tools */}
              {/* Rota removida junto com o item de menu (ver AdminLayout).
                * A tela sempre da erro: manda `type: "catalog"` e a funcao
                * `generate-pdf` so aceita `pedido_id`.
                * <Route path="/admin/tools/pdf-catalog" element={<A><PdfCatalog /></A>} /> */}
              <Route path="/admin/tools/import-customer-prices" element={<A><ImportCustomerPrices /></A>} />
              <Route path="/admin/tools/import-customers" element={<A><ImportCustomers /></A>} />
              <Route path="/admin/tools/import-addresses" element={<A><ImportAddresses /></A>} />
              <Route path="/admin/tools/import-product-discounts" element={<A><ImportProductDiscounts /></A>} />
              <Route path="/admin/tools/import-related-products" element={<A><ImportRelatedProducts /></A>} />
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
              {/* TELA REMOVIDA em 25/ago/2026 — nao fazia nada.
                * Os links nao aparecem em menu nem tela nenhuma. A descricao promete 'acesso rapido para clientes', e nenhuma pagina do portal consulta a tabela.
                * PARA VOLTAR: o layout do portal (ou o painel do cliente) teria que ler `quick_links` e renderizar, com um mapeamento do campo `icone`.
                *
                * Ja estava fora do menu; isto fecha o link direto.
                * <Route path="/admin/settings/quick-links" element={<A><QuickLinks /></A>} />
                */}
              <Route path="/admin/settings/product-statuses" element={<A><ProductStatuses /></A>} />
              <Route path="/admin/settings/product-status-rules" element={<A><ProductStatusRules /></A>} />
              <Route path="/admin/settings/privacy-groups" element={<A><PrivacyGroups /></A>} />
              <Route path="/admin/settings/coupons" element={<A><Coupons /></A>} />
              <Route path="/admin/settings/sales-tax" element={<A><SalesTax /></A>} />
              {/* TELA REMOVIDA em 25/ago/2026 — nao fazia nada.
                * As unidades cadastradas aqui nao sao usadas. `produtos.unidade_venda` e digitacao LIVRE (um campo de texto no ProductEdit) ou vem do sync do B2BWave — sem nenhuma ligacao com esta tabela. Cuidado com a armadilha: existe `produtos.unidade_medida_id`, mas ela aponta para `product_options`, NAO para `measurement_units`, e tambem nao e lida por ninguem.
                * PARA VOLTAR: trocar o campo de texto de `unidade_venda` no ProductEdit por uma lista alimentada por `measurement_units`.
                *
                * Ja estava fora do menu; isto fecha o link direto.
                * <Route path="/admin/settings/measurement-unit" element={<A><MeasurementUnit /></A>} />
                */}
              <Route path="/admin/settings/company-activities" element={<A><CompanyActivities /></A>} />
              {/* TELA REMOVIDA em 25/ago/2026 — nao fazia nada.
                * Os campos definidos aqui nao aparecem em formulario nenhum — nem checkout, nem cadastro, nem produto. E NAO EXISTE tabela de valores: mesmo que a tela renderizasse os campos, nao haveria onde gravar a resposta.
                * PARA VOLTAR: criar `extra_field_values (extra_field_id, entidade, entidade_id, valor)` e um componente que consulte `extra_fields` por `view_location` em cada formulario.
                *
                * Ja estava fora do menu; isto fecha o link direto.
                * <Route path="/admin/settings/extra-fields" element={<A><ExtraFields /></A>} />
                */}
              {/* TELA REMOVIDA em 25/ago/2026 — nao fazia nada.
                * As chaves geradas aqui nao autenticam nada. A API real compara o header `x-api-token` com `configuracoes.api_token` (`functions/api/index.ts`); uma chave `bj_...` desta tela devolve 403. Os `scopes` e `allowed_ips` tambem nao sao lidos — o token unico da acesso total.
                * PARA VOLTAR: a edge `api` teria que procurar o token recebido em `api_keys` (checando `ativo`, `allowed_ips` e `scopes`) em vez de comparar com `configuracoes.api_token`.
                *
                * Ja estava fora do menu; isto fecha o link direto.
                * <Route path="/admin/settings/api-keys" element={<A><ApiKeys /></A>} />
                */}
              <Route path="/admin/settings/b2bwave-sync" element={<A><B2BWaveSync /></A>} />
              {/* TELA REMOVIDA em 25/ago/2026 — nao fazia nada.
                * Nao existe endpoint OAuth neste sistema. Nenhuma das edge functions fala `/authorize` ou `/token`, e o `client_id`/`client_secret` gerados aqui nao sao validados por nada. O `redirect_uri` padrao aponta para um app mobile que nao existe.
                * PARA VOLTAR: precisaria de uma edge function OAuth2 completa (authorize + token + tabela de codigos), validando contra `oauth_applications`. Hoje nao ha nem o esqueleto.
                *
                * Ja estava fora do menu; isto fecha o link direto.
                * <Route path="/admin/settings/oauth-applications" element={<A><OauthApplications /></A>} />
                */}
              {/* Settings — staff COM checagem de permissão por papel */}
              <Route path="/admin/settings/edit-password" element={<S><EditPassword /></S>} />
              {/* ADMIN-ONLY desde 25/ago/2026. As duas telas fazem `select("*")`
                * em `configuracoes`, e a LINHA carrega `api_token` (bearer da edge
                * `api`, que roda com service role), `stripe_secret_key`,
                * `stripe_webhook_secret`, `email_api_key` e as senhas de SMTP/Zapier.
                * RLS no Postgres e por LINHA: nao da para "mostrar sem os segredos".
                * O `Profile` ainda renderizava `api_token` e `zapier_password` em
                * TEXTO PURO na tela do manager.
                * O banco tambem passou a recusar (20260825290000) — isto aqui evita
                * que o manager caia numa tela quebrada em vez de nao ver o item. */}
              <Route path="/admin/settings/profile" element={<A><SettingsProfile /></A>} />
              <Route path="/admin/settings/email" element={<A><EmailSettings /></A>} />
              {/* Consolidado na aba "Email" de Notifications (2026-07-10) — ver docs/EMAIL-CONSOLIDACAO.md */}
              <Route path="/admin/settings/email-templates" element={<Navigate to="/admin/settings/notifications" replace />} />
              <Route path="/admin/settings/notifications" element={<A><Notificacoes /></A>} />
              <Route path="/admin/settings/notifications-log" element={<A><NotificacoesLog /></A>} />
              <Route path="/admin/settings/users" element={<SP perm="view_users_management"><UsersManagement /></SP>} />
              <Route path="/admin/settings/warehouse" element={<SP perm="view_warehouse_settings"><WarehouseSettings /></SP>} />
              <Route path="/admin/settings/activity-logs" element={<SP perm="view_activity_logs"><ActivityLogs /></SP>} />

              {/* Legacy routes redirect */}
              <Route path="/admin/pedidos" element={<A><AdminPedidos /></A>} />
              <Route path="/admin/produtos" element={<A><AdminProdutos /></A>} />
              <Route path="/admin/categorias" element={<A><AdminCategorias /></A>} />
              <Route path="/admin/clientes" element={<A><AdminClientes /></A>} />
              <Route path="/admin/estoque" element={<AW><AdminEstoque /></AW>} />
              <Route path="/admin/estoque/adjustment" element={<AW><InventoryAdjustment /></AW>} />
              <Route path="/admin/tabelas-preco" element={<A><AdminTabelasPreco /></A>} />
              <Route path="/admin/relatorios" element={<A><AdminRelatorios /></A>} />
              <Route path="/admin/configuracoes" element={<A><AdminConfiguracoes /></A>} />
              <Route path="/admin/noticias" element={<A><AdminNoticias /></A>} />
              <Route path="/admin/paginas" element={<A><AdminPaginas /></A>} />
              <Route path="/admin/representantes" element={<A><AdminRepresentantes /></A>} />
              <Route path="/admin/ferramentas" element={<A><AdminFerramentas /></A>} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </CartProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
