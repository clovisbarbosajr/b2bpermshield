import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

const ProductStatusRules = () => (
  <AdminLayout>
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h2 className="font-display text-2xl font-semibold">Product Status Rules</h2>
        <p className="mt-1 text-sm text-muted-foreground">Define rules that automatically change product status based on inventory levels.</p>
      </div>
      <Button className="gap-1"><Plus className="h-4 w-4" /> Add Rule</Button>
    </div>
    <Card className="p-8 text-center text-muted-foreground">
      <p>No rules configured yet. Rules can automatically set products to "Out of Stock" when inventory reaches zero.</p>
    </Card>
  </AdminLayout>
);

export default ProductStatusRules;
