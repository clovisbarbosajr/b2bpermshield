# MENU_OCULTO — Itens ocultados do painel admin (2026-06-18)

> **Nada foi deletado.** Estes itens foram apenas **comentados** no menu
> (`src/components/layouts/AdminLayout.tsx`, array `adminNavEntries`).
> As **rotas** (`src/App.tsx`) e as **telas/funções** continuam **100% intactas** e
> acessíveis digitando a URL. Para reativar no menu: **descomente a linha** correspondente.
> Motivo: enquanto migramos para o fluxo de **sync** (B2BWave → app), estas telas
> manuais não serão usadas. Decisão temporária.

## Itens ocultos

| Item | Rota (ainda funciona por URL) | Tela/arquivo |
|------|-------------------------------|--------------|
| Settings → **Setup App** | `/admin/settings/setup-app` | `settings/SetupApp.tsx` |
| **Banners** | `/admin/banners` | `admin/Banners.tsx` |
| **News** | `/admin/news` | `admin/Noticias.tsx` |
| **Pages** | `/admin/pages` | `admin/Paginas.tsx` |
| Tools → **Import Customer Prices** | `/admin/tools/import-customer-prices` | `tools/ImportCustomerPrices.tsx` |
| Tools → **Import Customers** | `/admin/tools/import-customers` | `tools/ImportCustomers.tsx` |
| Tools → **Import Addresses** | `/admin/tools/import-addresses` | `tools/ImportAddresses.tsx` |
| Tools → **Import Product Variants** | `/admin/tools/import-product-variants` | `tools/ImportProductVariants.tsx` |
| Tools → **Import Categories** | `/admin/tools/import-categories` | `tools/ImportCategories.tsx` |
| Tools → **Import Orders** | `/admin/tools/import-orders` | `tools/ImportOrders.tsx` |
| Tools → **Bulk Update Orders** | `/admin/tools/bulk-update-orders` | `tools/BulkUpdateOrders.tsx` |
| Tools → **Imports Log** | `/admin/tools/imports-log` | `tools/ImportsLog.tsx` |
| Tools → **Exports Log** | `/admin/tools/exports-log` | `tools/ExportsLog.tsx` |

## MANTIDOS visíveis (não estavam na sua lista — confirme se quer ocultar também)
- Tools → **PDF Catalog** (`/admin/tools/pdf-catalog`)
- Tools → **Import Product Discounts** (`/admin/tools/import-product-discounts`)
- Products → **Import** (`/admin/products/import`) e **Export** (`/admin/products/export`)

## Como reativar
1. Abra `src/components/layouts/AdminLayout.tsx`.
2. Descomente a linha do item desejado (tire o `//`).
3. Pronto — volta a aparecer no menu. (As `<Route>` em `App.tsx` nunca foram tocadas.)

## Observações
- O "Import products to B2B Wave - Quickbooks" e "Update B2B Wave inventory - Quickbooks"
  que você citou são telas do **B2BWave de referência** (zapsupplies), não existem no nosso
  painel — por isso não há o que ocultar aqui.
- "Email" e "Email Templates" já tinham sido tirados do menu antes (consolidados em Notifications).
