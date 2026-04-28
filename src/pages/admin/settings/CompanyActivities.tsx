import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

// CompanyActivities manages the list of business activity TYPES that
// can be assigned to customers (e.g. Distributor, Contractor, Retailer…)
// Stored in company_activities table with just the 'tipo' (name) field.

const CompanyActivities = () => {
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    // We only want unique type names — use tipo as the activity category name
    const { data } = await supabase
      .from("company_activities")
      .select("*")
      .is("customer_name", null)        // activity TYPES have no customer attached
      .order("tipo");
    setActivities(data ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const openNew = () => {
    setEditing(null);
    setName("");
    setDialogOpen(true);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setName(r.tipo ?? "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    if (editing) {
      const { error } = await supabase
        .from("company_activities")
        .update({ tipo: name.trim() })
        .eq("id", editing.id);
      if (error) toast.error(error.message);
      else toast.success("Updated");
    } else {
      const { error } = await supabase
        .from("company_activities")
        .insert({ tipo: name.trim() });
      if (error) toast.error(error.message);
      else toast.success("Created");
    }
    setSaving(false);
    setDialogOpen(false);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this activity?")) return;
    await supabase.from("company_activities").delete().eq("id", id);
    toast.success("Deleted");
    fetchData();
  };

  if (loading) return (
    <AdminLayout>
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    </AdminLayout>
  );

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Company activities</h2>
      </div>

      <Button
        onClick={openNew}
        className="mb-4 gap-1 bg-emerald-600 hover:bg-emerald-700"
      >
        <Plus className="h-4 w-4" /> New company activity
      </Button>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {activities.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="text-center py-8 text-muted-foreground">
                  No company activities yet. Click "+ New company activity" to add one.
                </TableCell>
              </TableRow>
            ) : activities.map(a => (
              <TableRow key={a.id}>
                <TableCell className="font-medium text-primary">{a.tipo}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="default"
                      size="icon"
                      className="h-8 w-8 bg-cyan-600 hover:bg-cyan-700"
                      onClick={() => openEdit(a)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleDelete(a.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit" : "New"} Company Activity</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Name *</Label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Distributor, Contractor, Retailer"
                onKeyDown={e => e.key === "Enter" && handleSave()}
                autoFocus
              />
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
};

export default CompanyActivities;
