import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Info } from "lucide-react";

// NOTA: as regras de status por produto são configuradas na aba
// "Product Status Rules" dentro da edição de cada produto (ProductEdit).
// Esta tela global era um placeholder sem ação ("Add Rule" não fazia nada),
// então passou a apenas direcionar o operador para o local correto.
const ProductStatusRules = () => (
  <AdminLayout>
    <div className="mb-6">
      <h2 className="font-display text-2xl font-semibold">Product Status Rules</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Rules that automatically change a product's status based on inventory levels.
      </p>
    </div>
    <Card className="flex items-start gap-3 p-6">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <div className="text-sm text-muted-foreground">
        Status rules are configured <strong>per product</strong>. Open a product in{" "}
        <strong>Products → (edit) → "Product Status Rules"</strong> tab to add rules such as
        “set to <em>Sold Out</em> when quantity ≤ 0”.
      </div>
    </Card>
  </AdminLayout>
);

export default ProductStatusRules;
