import { useAuth } from "@/contexts/AuthContext";
import { Link } from "react-router-dom";

const ViewAsBanner = () => {
  const { impersonatedCustomer, clearViewAs } = useAuth();

  if (!impersonatedCustomer) return null;

  const companyName = impersonatedCustomer.empresa || impersonatedCustomer.nome || "Customer";

  const handleReturnToAdmin = () => {
    clearViewAs();
    window.close();
  };

  return (
    <div className="w-full bg-[hsl(45,70%,25%)] border-b border-[hsl(45,70%,35%)] px-4 py-2 flex items-center justify-center gap-3 text-sm z-50">
      <span className="text-[hsl(45,20%,70%)]">Return to</span>
      <div className="flex gap-1">
        <button
          onClick={handleReturnToAdmin}
          className="px-3 py-1 border border-[hsl(45,20%,50%)] text-[hsl(0,0%,85%)] hover:bg-[hsl(45,30%,30%)] transition-colors text-xs font-semibold uppercase tracking-wide"
        >
          Dashboard
        </button>
        <button
          onClick={handleReturnToAdmin}
          className="px-3 py-1 border border-[hsl(45,20%,50%)] text-[hsl(0,0%,85%)] hover:bg-[hsl(45,30%,30%)] transition-colors text-xs font-semibold uppercase tracking-wide"
        >
          Orders
        </button>
        <button
          onClick={handleReturnToAdmin}
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
