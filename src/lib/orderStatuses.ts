// Fonte ÚNICA dos status de pedido — espelha exatamente os 7 do B2BWave.
// Antes cada tela tinha seu próprio mapa (PT/EN, inconsistente). Use sempre isto.

export type OrderStatus = {
  value: string;
  label: string;
  badge: string; // classes do badge (cor)
};

export const ORDER_STATUSES: OrderStatus[] = [
  { value: "submitted",        label: "Submitted",        badge: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { value: "ready_for_pickup", label: "Ready for Pickup", badge: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
  { value: "partial",          label: "Partial",          badge: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  { value: "on_hold",          label: "On Hold",          badge: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  { value: "sent",             label: "Sent",             badge: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  { value: "complete",         label: "Complete",         badge: "bg-green-500/20 text-green-400 border-green-500/30" },
  { value: "cancelled",        label: "Canceled",         badge: "bg-red-500/20 text-red-400 border-red-500/30" },
];

// Mapeia valores legados (PT) -> canônico (EN), para exibir pedidos antigos sem quebrar.
const LEGACY: Record<string, string> = {
  recebido: "submitted",
  em_processamento: "on_hold",
  processando: "on_hold",
  em_separacao: "ready_for_pickup",
  enviado: "sent",
  concluido: "complete",
  cancelado: "cancelled",
};

export const canonicalStatus = (s?: string | null): string =>
  s ? (LEGACY[s] ?? s) : "submitted";

const find = (s?: string | null) => ORDER_STATUSES.find((o) => o.value === canonicalStatus(s));

export const statusLabel = (s?: string | null): string => find(s)?.label ?? (s ?? "");
export const statusBadge = (s?: string | null): string => find(s)?.badge ?? "bg-muted text-foreground";
