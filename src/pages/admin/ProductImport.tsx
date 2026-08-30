import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Download, Info } from "lucide-react";

// NOTA: esta tela era um mockup estático (botões "Choose File"/"Download Template"
// sem ação e sem input de arquivo). A importação de produtos por CSV que REALMENTE
// funciona fica em Tools (/admin/ferramentas); a exportação em /admin/products/export.
// Em vez de fingir que importa, esta tela direciona para os fluxos reais.
const AdminProductImport = () => {
  const navigate = useNavigate();
  const { role } = useAuth();
  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Import / Export Products</h2>
        <p className="mt-1 text-sm text-muted-foreground">Bulk-manage products via CSV.</p>
      </div>

      <Card className="mb-6 flex items-start gap-3 p-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <p className="text-sm text-muted-foreground">
          Use the tools below for working CSV import/export. (This page previously showed a
          non-functional upload form.)
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Import products (CSV)</h3>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Upload a CSV to create/update products in bulk.
          </p>
          {/* SO PARA ADMIN. Esta pagina e `view_products`, que manager e warehouse
              tem — mas `/admin/ferramentas` e admin puro. Para eles o clique caia
              no `Navigate to="/"` do `ProtectedRoute` e o `LoginLanding` devolvia
              para `/admin`: teleporte silencioso, sem uma palavra. O card de
              Export ao lado FUNCIONA para os tres papeis, entao a pagina continua
              util — o que nao pode e o botao prometer o que a rota nega. */}
          {role !== "admin" ? (
            <p className="text-sm text-muted-foreground">
              Bulk import is available to administrators only.
            </p>
          ) : (
          <Button onClick={() => navigate("/admin/ferramentas")} className="gap-1">
            <Upload className="h-4 w-4" /> Go to Import Tools
          </Button>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Export products (CSV)</h3>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Download your catalog as a CSV (with categories, prices and privacy groups).
          </p>
          <Button variant="outline" onClick={() => navigate("/admin/products/export")} className="gap-1">
            <Download className="h-4 w-4" /> Go to Export
          </Button>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default AdminProductImport;
