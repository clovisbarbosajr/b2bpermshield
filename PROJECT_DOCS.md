# B2B PermShield — Project Documentation

> **Last updated:** 2026-04-10
> **Keep this file up to date and send it at the start of each new session.**

---

## 1. Overview

**B2B PermShield** is a B2B SaaS system built from scratch to replace B2BWave as the B2B sales platform for **ZapSupplies** (flooring).

- **GitHub:** https://github.com/clovisbarbosajr/b2bpermshield
- **Deploy (Vercel):** https://b2bpermshield.vercel.app
- **B2BWave admin user:** `zapsupplies`

---

## 2. Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite |
| UI | shadcn/ui + TailwindCSS |
| Backend/DB | Supabase (PostgreSQL + Auth + Edge Functions) |
| Deploy | Vercel (frontend) + Supabase (backend) |
| Payments | Stripe (integrated, awaiting keys) |
| Email | Resend / SendGrid / SMTP Office 365 (integrated) |

---

## 3. File Structure

```
b2bpermshield-main/
├── src/
│   ├── App.tsx                              # Routes (S = any staff, A = admin only)
│   ├── lib/
│   │   └── permissions.ts                  # Permission keys, groups, defaults per role
│   ├── contexts/
│   │   ├── AuthContext.tsx                  # Auth: roles (admin/manager/warehouse/cliente), permissions, hasPermission()
│   │   └── CartContext.tsx                  # Shopping cart
│   ├── hooks/
│   │   └── useActivityLog.ts               # Hook to log actions to activity_logs table
│   ├── components/
│   │   ├── layouts/AdminLayout.tsx          # Admin sidebar (role-aware + permission-aware nav)
│   │   ├── ProtectedRoute.tsx              # Route guard (admin / staff / cliente / requiredPermission)
│   │   └── warehouse/
│   │       ├── MondayPopup.tsx             # Mandatory stock reminder popup (warehouse only)
│   │       └── InactivityLogout.tsx        # Auto-logout after inactivity (warehouse only)
│   ├── pages/
│   │   ├── AdminLogin.tsx                  # /admin-login — allows admin + manager + warehouse
│   │   ├── CustomerLogin.tsx               # /customers-login
│   │   ├── admin/
│   │   │   ├── CustomerEdit.tsx            # Approve/reject customers + activity logging
│   │   │   ├── OrderDetail.tsx             # Status changes + activity logging
│   │   │   ├── Produtos.tsx                # Product list + delete logging
│   │   │   ├── ProductEdit.tsx             # Product create/edit + activity logging
│   │   │   └── settings/
│   │   │       ├── EmailSettings.tsx       # Email config + recipients + notification toggles
│   │   │       ├── EmailTemplates.tsx      # Email template editor + PDF template tab
│   │   │       ├── UsersManagement.tsx     # Create/edit admin/manager/warehouse users + permission checkboxes
│   │   │       ├── WarehouseSettings.tsx   # Popup config, inactivity timeout
│   │   │       └── ActivityLogs.tsx        # Activity log viewer (date range + filters)
│   └── assets/
│       ├── adminportal.jpg                 # Admin Login background — DO NOT MODIFY
│       └── customers.jpg                   # Customer Login background — DO NOT MODIFY
│
├── supabase/
│   ├── functions/
│   │   ├── admin-create-user/              # Creates auth users + list_staff + update_password actions
│   │   ├── generate-pdf/                   # Generates order PDF (HTML, English, USD)
│   │   ├── send-email/                     # Resend / SendGrid / SMTP (full order body, BCC)
│   │   └── stripe-checkout/               # PaymentIntent + Webhook
│   └── migrations/
│       ├── ...earlier migrations...
│       ├── 20260409000001_create_admin_jessika.sql    # Assigns admin role (user created via Dashboard)
│       ├── 20260409000002_pdf_order_template.sql
│       ├── 20260409000003_warehouse_and_logs.sql      # warehouse role + activity_logs table
│       ├── 20260409000004_warehouse_settings.sql      # popup + inactivity settings columns
│       ├── 20260409000005_fix_admin_identity.sql      # Fix auth.identities for jess@zapsupplies.com
│       └── 20260410000001_manager_permissions.sql     # manager role + permissions JSONB column
│
└── PROJECT_DOCS.md
```

> ⚠️ **Never modify binary files in `src/assets/`** (.png, .jpg, .jpeg, .gif, .ico, .svg, .woff, .woff2). Treat them as read-only.

---

## 4. Database — Key Tables

| Table | Description |
|-------|-------------|
| `auth.users` | Supabase Auth users |
| `user_roles` | Roles: `admin`, `manager`, `warehouse`, `cliente` + `permissions JSONB` |
| `clientes` | B2B customer companies (status: pendente/ativo/rejeitado) |
| `company_contacts` | Sub-logins: buyer / viewer / manager |
| `produtos` | Product catalog |
| `categorias` | Categories |
| `produto_acesso` | Access by privacy_group_id |
| `privacy_groups` | Privacy groups |
| `enderecos` | Delivery addresses |
| `pedidos` | Orders |
| `pedido_itens` | Order items |
| `tabelas_preco` | Price lists |
| `shipping_options` | Shipping options |
| `payment_options` | Payment options |
| `tax_rates` | Sales Tax |
| `coupons` | Discount coupons |
| `import_logs` | CSV import log |
| `api_keys` | Generated API keys |
| `activity_logs` | Action log (create/edit/delete for products, customers, orders) |
| `configuracoes` | Global settings (single row) |

### Key columns in `configuracoes`:
```sql
-- Email
email_provider             -- "resend" | "sendgrid" | "smtp"
email_api_key              -- API key (Resend/SendGrid only)
email_from                 -- "Name <email@domain.com>"
email_reply_to             -- reply-to email (e.g. jess@zapsupplies.com)
email_new_orders           -- comma-separated: admin emails for new order notifications
email_new_customer         -- comma-separated: admin emails for new customer notifications
bcc_outgoing_emails        -- comma-separated: BCC on all customer-facing emails

-- PDF
pdf_order_template         -- custom HTML for order PDF (null = system default)

-- Warehouse behavior
warehouse_popup_enabled      -- boolean
warehouse_popup_message      -- text
warehouse_popup_day          -- integer (0=Sun, 1=Mon, ..., 6=Sat)
warehouse_inactivity_popup   -- integer: minutes on popup day
warehouse_inactivity_default -- integer: minutes on other days
```

---

## 5. Roles & Permissions

### Role overview

| Role | Description |
|------|-------------|
| `admin` | Full access to everything. No permission UI — always unrestricted. |
| `manager` | Full access by default except Activity Logs. Permissions customizable per user. |
| `warehouse` | Limited access by default (products, customers, orders only). Permissions customizable per user. |
| `cliente` | Customer portal only. |

### Default permissions per role

| Permission | admin | manager | warehouse |
|------------|:-----:|:-------:|:---------:|
| View Dashboard | ✅ | ✅ | ✅ |
| View / Edit Orders | ✅ | ✅ | ✅ |
| Delete Orders | ✅ | ✅ | ❌ |
| Change Order Status | ✅ | ✅ | ✅ |
| View / Edit / Create Customers | ✅ | ✅ | ✅ |
| Approve / Reject Customers | ✅ | ✅ | ✅ |
| Delete Customers | ✅ | ✅ | ❌ |
| View / Create / Edit / Delete Products | ✅ | ✅ | ✅ |
| Profile & Company Settings | ✅ | ✅ | ❌ |
| Email Settings | ✅ | ✅ | ❌ |
| Email Templates | ✅ | ✅ | ❌ |
| Warehouse Settings | ✅ | ✅ | ❌ |
| User Management | ✅ | ✅ | ❌ |
| Activity Logs | ✅ | ❌ | ❌ |

Permissions are stored as `JSONB` in `user_roles.permissions` and are **customizable per user** via Admin → Settings → Users → Edit (pencil icon).

---

## 6. Warehouse User Behavior

### Login popup reminder (warehouse only)
- Configurable via Admin → Settings → Warehouse Settings
- Shows a mandatory dialog on the configured day (default: Monday)
- User must check "I have already updated the stock" and click Confirm
- Reappears on every login on that day (module-level flag, cleared on page reload)
- Manager and Admin are NOT affected by this popup

### Inactivity auto-logout (warehouse only)
- **On popup day:** configurable timeout (default: 5 minutes)
- **Other days:** configurable timeout (default: 8 hours / 480 minutes)
- Inactivity detection: mouse, keyboard, scroll, touch
- Manager and Admin are NOT affected by inactivity logout

---

## 7. Authentication Flow

```
Login (email + password) → AdminLogin.tsx
  ↓
Check user_roles:
  ├─ "admin"     → /admin (full access, no restrictions)
  ├─ "manager"   → /admin (permission-based nav, no popup/inactivity)
  ├─ "warehouse" → /admin (permission-based nav, popup + inactivity active)
  └─ other / none → error, sign out

Login → CustomerLogin.tsx
  ↓
AuthContext fetches role and permissions (awaited before loading=false)
  ├─ "cliente" → check clientes.status
  │     ├─ "ativo" → /portal
  │     └─ others → /pending-approval
  └─ No user_roles → check company_contacts
        ├─ Found → impersonatedCustomer + contactRole → /portal
        └─ Not found → /pending-approval
```

> ⚠️ Admin/manager/warehouse users are **never** inserted into the `clientes` table. The `ensureClienteRecord` function only runs for `cliente` role accounts.

### Company Contacts — Role enforcement:
| Role | Add to cart | Checkout | View orders |
|------|:-----------:|:--------:|:-----------:|
| `buyer` | ✅ | ✅ | All company orders |
| `manager` | ✅ | ✅ | All company orders |
| `viewer` | ❌ | ❌ | All company orders (read-only) |

---

## 8. Activity Logs

Every create/edit/delete action by any staff user (admin, manager, warehouse) is logged to `activity_logs`.

### What is logged:
| Where | Actions |
|-------|---------|
| ProductEdit | created, updated |
| Produtos (list) | deleted |
| CustomerEdit | created, updated, approved |
| OrderDetail | updated (save), updated (status change), deleted |

### Log fields:
- `user_id`, `user_email`, `user_name` — who did it
- `action` — `created` | `updated` | `deleted`
- `entity_type` — `product` | `customer` | `order`
- `entity_id`, `entity_name` — what was affected
- `details` — optional JSON (e.g. `{ status: "enviado" }`)
- `created_at` — timestamp

### Viewing logs (Admin → Settings → Activity Logs):
- Filter by: action, entity type, user email
- Filter by date range: from / to (with quick buttons: Last 7 days, Last 30 days, This month)
- Paginated (50 per page)
- Access controlled by `view_activity_logs` permission (admin always has it; others need it enabled)

---

## 9. Email System

### Supported providers:
| Provider | `email_provider` | Key |
|----------|-----------------|-----|
| Resend | `"resend"` | `re_xxx...` |
| SendGrid | `"sendgrid"` | `SG.xxx...` |
| Office 365 | `"smtp"` | password in Supabase Secrets |

### Order confirmation email (sent to customer):
Full order details are embedded directly in the email body — **no PDF attachment**. Includes:
- Company header (name, address, email from `configuracoes`)
- Bill To section (customer company, name, email, address)
- Order metadata (date, PO number, delivery date, payment, shipping)
- Items table (code, product, qty, unit price, total)
- Totals (subtotal, discount, shipping, tax, gross total)
- Notes block

### Email triggers:
| Event | Who receives |
|-------|-------------|
| Customer signup | Customer gets "Waiting for approval" email |
| Admin notified of signup | `email_new_customer` list |
| Account approved | Customer gets approval email |
| Account rejected | Customer gets rejection email |
| New order placed | Customer gets full order confirmation + `email_new_orders` list |
| Order status changed | Customer gets status update email |
| Contact created | Contact gets set-password link |

---

## 10. `admin-create-user` Edge Function

Supports 3 actions via `body.action`:

| action | Description |
|--------|-------------|
| _(none)_ | Create a new auth user (email + password + nome) |
| `list_staff` | Fetch email/nome/dates from `auth.users` for given `user_ids` array |
| `update_password` | Reset password for a given `user_id` |

---

## 11. Stripe — Payment Flow

### Setup (Admin → Settings → Payments):
1. Publishable Key (`pk_live_...` or `pk_test_...`)
2. Secret Key (`sk_live_...` or `sk_test_...`)
3. Webhook Secret (`whsec_...`)
4. Enable Stripe → Save

### Webhook (configure in Stripe Dashboard):
- **URL:** `https://[project].supabase.co/functions/v1/stripe-checkout`
- **Events:** `payment_intent.succeeded`, `payment_intent.payment_failed`

---

## 12. Managing Users

### Create a new admin / manager / warehouse user:
→ Admin → Settings → Users → "Create user" → select role

### Edit permissions (manager / warehouse):
→ Admin → Settings → Users → click pencil icon → toggle permission checkboxes → Save

### Reset a user's password:
→ Admin → Settings → Users → click pencil icon → enter new password → Save

### Remove access:
→ Admin → Settings → Users → trash icon
→ Removes `user_roles` entry only — auth account is kept

### Change warehouse popup / timeout settings:
→ Admin → Settings → Warehouse Settings

> ⚠️ To create the very first admin user, or if auth is corrupted: use Supabase Dashboard → Authentication → Users → Add user (with Auto Confirm), then run:
> ```sql
> INSERT INTO public.user_roles (user_id, role)
> SELECT id, 'admin' FROM auth.users WHERE email = 'jess@zapsupplies.com'
> ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
> ```

---

## 13. Admin Users

| Email | Role | Password |
|-------|------|----------|
| `jess@zapsupplies.com` | admin | `Blades4u!` — change after first login |

---

## 14. Pending Actions

| # | Action | Where |
|---|--------|-------|
| 1 | Apply migration `20260410000001_manager_permissions.sql` | Lovable → apply migration |
| 2 | Configure email provider | Admin → Settings → Email |
| 3 | Set Reply-To to `jess@zapsupplies.com` | Admin → Settings → Email |
| 4 | Add admin recipients | Admin → Settings → Email → Email Recipients |
| 5 | Configure Stripe keys | Admin → Settings → Payments |
| 6 | Register Stripe webhook | dashboard.stripe.com → Developers → Webhooks |
