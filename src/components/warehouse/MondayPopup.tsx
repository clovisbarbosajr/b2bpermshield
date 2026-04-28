import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PackageCheck } from "lucide-react";

// Module-level flag: reset on every full page load / sign-in
let _confirmedThisSession = false;

type Settings = {
  warehouse_popup_enabled: boolean;
  warehouse_popup_message: string;
  warehouse_popup_day: number;
};

const DEFAULT_SETTINGS: Settings = {
  warehouse_popup_enabled: true,
  warehouse_popup_message:
    "Please make sure inventory levels are up to date before starting your shift.",
  warehouse_popup_day: 1, // Monday
};

const MondayPopup = () => {
  const { role, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const shownForUser = useRef<string | null>(null);

  useEffect(() => {
    if (role !== "warehouse" || !user?.id) return;

    const loadAndDecide = async () => {
      // Fetch config from DB
      const { data } = await (supabase as any)
        .from("configuracoes")
        .select("warehouse_popup_enabled, warehouse_popup_message, warehouse_popup_day")
        .limit(1)
        .maybeSingle();

      const cfg: Settings = {
        warehouse_popup_enabled:
          data?.warehouse_popup_enabled ?? DEFAULT_SETTINGS.warehouse_popup_enabled,
        warehouse_popup_message:
          data?.warehouse_popup_message ?? DEFAULT_SETTINGS.warehouse_popup_message,
        warehouse_popup_day:
          data?.warehouse_popup_day ?? DEFAULT_SETTINGS.warehouse_popup_day,
      };
      setSettings(cfg);

      if (!cfg.warehouse_popup_enabled) return;

      // Only on the configured day
      const today = new Date().getDay();
      if (today !== cfg.warehouse_popup_day) return;

      // Show once per page load per user
      if (_confirmedThisSession) return;
      if (shownForUser.current === user.id) return;

      shownForUser.current = user.id;
      setOpen(true);
    };

    loadAndDecide();
  }, [role, user?.id]);

  const handleConfirm = () => {
    if (!checked) return;
    _confirmedThisSession = true;
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-sm"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <PackageCheck className="h-5 w-5 text-primary" />
            Stock Reminder
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            {settings.warehouse_popup_message || DEFAULT_SETTINGS.warehouse_popup_message}
          </p>
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              id="stock-confirm"
              checked={checked}
              onCheckedChange={(v) => setChecked(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="stock-confirm" className="cursor-pointer text-sm leading-relaxed">
              I have already updated the stock
            </Label>
          </label>
          <Button className="w-full" disabled={!checked} onClick={handleConfirm}>
            Confirm &amp; Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MondayPopup;
