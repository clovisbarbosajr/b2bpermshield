// ─── Permission keys ─────────────────────────────────────────────────────────
export type PermissionKey =
  | "view_dashboard"
  | "view_orders" | "create_orders" | "edit_orders" | "delete_orders" | "change_order_status"
  | "view_customers" | "create_customers" | "edit_customers" | "approve_customers" | "delete_customers"
  | "view_products" | "create_products" | "edit_products" | "delete_products"
  | "view_email_settings" | "view_email_templates" | "view_profile_settings"
  | "view_warehouse_settings" | "view_users_management" | "view_activity_logs";

// ─── Labels and grouping (used in UsersManagement checkboxes) ─────────────────
export const PERMISSION_GROUPS: { group: string; keys: { key: PermissionKey; label: string }[] }[] = [
  {
    group: "Dashboard",
    keys: [
      { key: "view_dashboard", label: "View Dashboard" },
    ],
  },
  {
    group: "Orders",
    keys: [
      { key: "view_orders",         label: "View Orders" },
      { key: "create_orders",       label: "Create Orders (on behalf of customers)" },
      { key: "edit_orders",         label: "Edit Orders" },
      { key: "change_order_status", label: "Change Order Status" },
      { key: "delete_orders",       label: "Delete Orders" },
    ],
  },
  {
    group: "Customers",
    keys: [
      { key: "view_customers",     label: "View Customers" },
      { key: "create_customers",   label: "Create Customers" },
      { key: "edit_customers",     label: "Edit Customers" },
      { key: "approve_customers",  label: "Approve / Reject Customers" },
      { key: "delete_customers",   label: "Delete Customers" },
    ],
  },
  {
    group: "Products",
    keys: [
      { key: "view_products",   label: "View Products" },
      { key: "create_products", label: "Create Products" },
      { key: "edit_products",   label: "Edit Products" },
      { key: "delete_products", label: "Delete Products" },
    ],
  },
  {
    group: "Settings",
    keys: [
      { key: "view_profile_settings",   label: "Profile & Company Settings" },
      { key: "view_email_settings",     label: "Email Settings" },
      { key: "view_email_templates",    label: "Email Templates" },
      { key: "view_warehouse_settings", label: "Warehouse Settings" },
      { key: "view_users_management",   label: "User Management" },
      { key: "view_activity_logs",      label: "Activity Logs (read-only)" },
    ],
  },
];

// ─── Default permissions per role ─────────────────────────────────────────────
export const DEFAULT_PERMISSIONS: Record<"warehouse" | "manager", Record<PermissionKey, boolean>> = {
  warehouse: {
    view_dashboard:       true,
    view_orders:          true,
    create_orders:        true,
    edit_orders:          true,
    delete_orders:        false,
    change_order_status:  true,
    view_customers:       true,
    create_customers:     true,
    edit_customers:       true,
    approve_customers:    true,
    delete_customers:     false,
    view_products:        true,
    create_products:      true,
    edit_products:        true,
    delete_products:      true,
    view_profile_settings:   false,
    view_email_settings:     false,
    view_email_templates:    false,
    view_warehouse_settings: false,
    view_users_management:   false,
    view_activity_logs:      false,
  },
  manager: {
    view_dashboard:       true,
    view_orders:          true,
    create_orders:        true,
    edit_orders:          true,
    delete_orders:        true,
    change_order_status:  true,
    view_customers:       true,
    create_customers:     true,
    edit_customers:       true,
    approve_customers:    true,
    delete_customers:     true,
    view_products:        true,
    create_products:      true,
    edit_products:        true,
    delete_products:      true,
    view_profile_settings:   true,
    view_email_settings:     true,
    view_email_templates:    true,
    view_warehouse_settings: true,
    view_users_management:   true,
    view_activity_logs:      false, // only admin sees logs by default
  },
};
