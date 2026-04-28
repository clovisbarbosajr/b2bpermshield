import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const EditPassword = () => {
  const { isDemo } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (isDemo) { toast.info("Demo mode - password not changed"); return; }
    if (newPassword.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    if (newPassword !== confirmPassword) { toast.error("Passwords do not match"); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) { toast.error(error.message); setSaving(false); return; }
    toast.success("Password updated successfully");
    setNewPassword("");
    setConfirmPassword("");
    setSaving(false);
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold">Edit Password</h2>
        <p className="mt-1 text-sm text-muted-foreground">Change your admin account password.</p>
      </div>
      <Card className="max-w-md p-6">
        <div className="space-y-4">
          <div><Label>New Password</Label><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></div>
          <div><Label>Confirm New Password</Label><Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></div>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Updating..." : "Update Password"}</Button>
        </div>
      </Card>
    </AdminLayout>
  );
};

export default EditPassword;
