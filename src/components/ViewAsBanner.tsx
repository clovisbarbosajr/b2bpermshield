import { useAuth } from "@/contexts/AuthContext";

const ViewAsBanner = () => {
  const { impersonatedCustomer, clearViewAs } = useAuth();

  if (!impersonatedCustomer) return null;

  const companyName = impersonatedCustomer.empresa || impersonatedCustomer.nome || "Customer";

  // Cada botão volta pro SEU destino no admin. (Antes os 3 chamavam a mesma função,
  // que ia sempre pra /admin/customers + window.close() — inócuo, a aba é aberta com
  // noopener e o browser ignora o close.)
  const returnTo = (path: string) => clearViewAs(path);

  return (
    <div className="w-full bg-[hsl(45,70%,25%)] border-b border-[hsl(45,70%,35%)] px-4 py-2 flex items-center justify-center gap-3 text-sm z-50">
      <span className="text-[hsl(45,20%,70%)]">Return to</span>
      <div className="flex gap-1">
        <button
          onClick={() => returnTo("/admin")}
          className="px-3 py-1 border border-[hsl(45,20%,50%)] text-[hsl(0,0%,85%)] hover:bg-[hsl(45,30%,30%)] transition-colors text-xs font-semibold uppercase tracking-wide"
        >
          Dashboard
        </button>
        <button
          onClick={() => returnTo("/admin/orders")}
          className="px-3 py-1 border border-[hsl(45,20%,50%)] text-[hsl(0,0%,85%)] hover:bg-[hsl(45,30%,30%)] transition-colors text-xs font-semibold uppercase tracking-wide"
        >
          Orders
        </button>
        <button
          onClick={() => returnTo("/admin/customers")}
          className="px-3 py-1 border border-[hsl(45,20%,50%)] text-[hsl(0,0%,85%)] hover:bg-[hsl(45,30%,30%)] transition-colors text-xs font-semibold uppercase tracking-wide"
        >
          Customers
        </button>
      </div>
      <span className="text-[hsl(35,80%,60%)] ml-2">
        You are currently browsing products and placing orders as <strong>{companyName}</strong>.
      </span>
    </div>
  );
};

export default ViewAsBanner;
