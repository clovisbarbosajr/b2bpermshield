import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Download, FileText } from "lucide-react";

const AdminProductImport = () => {
  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Import Products</h2>
        <p className="mt-1 text-sm text-muted-foreground">Upload a CSV file to bulk import or update products.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-6">
          <h3 className="text-lg font-semibold">Upload CSV</h3>
          <p className="mt-2 text-sm text-muted-foreground">Upload a CSV file with product data. The file should include columns for name, SKU, price, category, and quantity.</p>
          <div className="mt-4 flex items-center justify-center rounded-lg border-2 border-dashed border-border p-8">
            <div className="text-center">
              <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">Drag & drop a CSV file here, or click to browse</p>
              <Button variant="outline" className="mt-4 gap-2"><Upload className="h-4 w-4" /> Choose File</Button>
            </div>
          </div>
        </Card>
        <Card className="p-6">
          <h3 className="text-lg font-semibold">Download Template</h3>
          <p className="mt-2 text-sm text-muted-foreground">Download a template CSV file with the correct columns and format for importing products.</p>
          <div className="mt-4 space-y-3">
            <Button variant="outline" className="w-full gap-2"><Download className="h-4 w-4" /> Download Products Template</Button>
            <Button variant="outline" className="w-full gap-2"><FileText className="h-4 w-4" /> View Import Guide</Button>
          </div>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default AdminProductImport;
