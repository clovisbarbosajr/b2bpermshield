import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Factory } from "lucide-react";

const ProducaoDashboard = () => (
  <AdminLayout>
    <div className="mb-6">
      <h2 className="font-display text-2xl font-semibold">Production — Dashboard</h2>
      <p className="text-sm text-muted-foreground">Items in production, grouped by location.</p>
    </div>
    <Card className="p-10 flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
      <Factory className="h-10 w-10 opacity-40" />
      <p>The production dashboard (by location) is being built in the next step.</p>
    </Card>
  </AdminLayout>
);

export default ProducaoDashboard;
