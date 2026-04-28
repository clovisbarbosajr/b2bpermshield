import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  RefreshCw, Package, FolderTree, Users, DollarSign, ShoppingCart,
  Tag, UserCheck, CheckCircle2, AlertCircle, Loader2, StopCircle
} from "lucide-react";

type SyncStatus = "idle" | "loading" | "success" | "error";

interface SyncItem {
  key: string;
  label: string;
  action: string;
  icon: React.ElementType;
  description: string;
}

const syncItems: SyncItem[] = [
  { key: "categories", label: "Categories", action: "sync_categories", icon: FolderTree, description: "Sync categories by name" },
  { key: "brands", label: "Brands", action: "sync_brands", icon: Tag, description: "Sync brands by name" },
  { key: "price_lists", label: "Price Lists", action: "sync_price_lists", icon: DollarSign, description: "Sync price lists by name" },
  { key: "sales_reps", label: "Sales Reps", action: "sync_sales_reps", icon: UserCheck, description: "Sync sales reps by email" },
  { key: "products", label: "Products", action: "sync_products", icon: Package, description: "Sync all products with correct wholesale price (upsert by SKU)" },
  { key: "customers", label: "Customers", action: "sync_customers", icon: Users, description: "Sync customers with price list & rep mapping" },
  { key: "privacy_groups", label: "Privacy Groups", action: "sync_privacy_groups", icon: Users, description: "Sync privacy groups" },
  { key: "company_activities", label: "Company Activities", action: "sync_company_activities", icon: Tag, description: "Sync company activity types" },
  { key: "extra_fields", label: "Extra Fields", action: "sync_extra_fields", icon: Tag, description: "Sync custom extra fields" },
  { key: "fix_order_prices", label: "Fix Order Prices ($0.00)", action: "fix_order_prices", icon: DollarSign, description: "Fix orders with $0.00 total — re-fetches prices from B2BWave API (up to 100 at a time)" },
];

const B2BWaveSync = () => {
  const [statuses, setStatuses] = useState<Record<string, SyncStatus>>({});
  const [results, setResults] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);

  // Order sync state
  const [orderSyncing, setOrderSyncing] = useState(false);
  const [orderProgress, setOrderProgress] = useState("");
  const [orderTotalSynced, setOrderTotalSynced] = useState(0);
  const [orderTotalSkipped, setOrderTotalSkipped] = useState(0);
  const [orderTotalItems, setOrderTotalItems] = useState(0);
  const [orderTotalErrors, setOrderTotalErrors] = useState(0);
  const stopRef = useRef(false);

  const testConnection = async () => {
    setTesting(true);
    setConnectionOk(null);
    try {
      const { data, error } = await supabase.functions.invoke("b2bwave-sync", {
        body: { action: "test" },
      });
      if (error) throw error;
      if (data?.success) {
        setConnectionOk(true);
        toast.success("Connection to B2B Wave successful!");
      } else {
        throw new Error(data?.error || "Connection failed");
      }
    } catch (err: any) {
      setConnectionOk(false);
      toast.error("Connection failed: " + (err.message || "Unknown error"));
    }
    setTesting(false);
  };

  const runSync = async (item: SyncItem) => {
    setStatuses((s) => ({ ...s, [item.key]: "loading" }));
    setResults((r) => ({ ...r, [item.key]: "" }));
    try {
      const { data, error } = await supabase.functions.invoke("b2bwave-sync", {
        body: { action: item.action },
      });
      if (error) throw error;
      if (data?.success) {
        setStatuses((s) => ({ ...s, [item.key]: "success" }));
        setResults((r) => ({ ...r, [item.key]: data.message || "Done" }));
        toast.success(`${item.label}: ${data.message}`);
      } else {
        throw new Error(data?.error || "Failed");
      }
    } catch (err: any) {
      setStatuses((s) => ({ ...s, [item.key]: "error" }));
      setResults((r) => ({ ...r, [item.key]: err.message }));
      toast.error(`${item.label}: ${err.message}`);
    }
  };

  const syncAllOrders = async () => {
    setOrderSyncing(true);
    stopRef.current = false;
    setOrderTotalSynced(0);
    setOrderTotalSkipped(0);
    setOrderTotalItems(0);
    setOrderTotalErrors(0);

    let page = 1;
    let offset = 0;
    let totalSynced = 0;
    let totalSkipped = 0;
    let totalItems = 0;
    let totalErrors = 0;

    while (!stopRef.current) {
      setOrderProgress(`Syncing page ${page}, offset ${offset}...`);
      try {
        const { data, error } = await supabase.functions.invoke("b2bwave-sync", {
          body: { action: "sync_orders_page", page, offset },
        });
        if (error) throw error;

        totalSynced += data.synced || 0;
        totalSkipped += data.skipped || 0;
        totalItems += data.items || 0;
        totalErrors += data.errors || 0;
        setOrderTotalSynced(totalSynced);
        setOrderTotalSkipped(totalSkipped);
        setOrderTotalItems(totalItems);
        setOrderTotalErrors(totalErrors);
        setOrderProgress(`Page ${page} offset ${offset}: ${data.synced} new, ${data.skipped || 0} skipped — Total: ${totalSynced} new, ${totalSkipped} skipped`);

        if (!data.hasMore) {
          setOrderProgress(`✅ Complete! ${totalSynced} new orders, ${totalSkipped} already existed, ${totalItems} items, ${totalErrors} errors`);
          toast.success(`Orders sync: ${totalSynced} new, ${totalSkipped} skipped`);
          break;
        }

        page = data.nextPage;
        offset = data.nextOffset;
      } catch (err: any) {
        totalErrors++;
        setOrderTotalErrors(totalErrors);
        setOrderProgress(`⚠️ Error on page ${page}: ${err.message}. Retrying...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (stopRef.current) {
      setOrderProgress(`⏹ Stopped. ${totalSynced} new, ${totalSkipped} skipped.`);
    }
    setOrderSyncing(false);
  };

  const stopOrderSync = () => {
    stopRef.current = true;
  };

  const syncAll = async () => {
    for (const item of syncItems) {
      await runSync(item);
    }
    await syncAllOrders();
  };

  const statusIcon = (key: string) => {
    const s = statuses[key];
    if (s === "loading") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    if (s === "success") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (s === "error") return <AlertCircle className="h-4 w-4 text-destructive" />;
    return null;
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold">B2B Wave Sync</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Import data from your B2B Wave account into this portal.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={testConnection} disabled={testing} className="gap-1">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Test Connection
          </Button>
          <Button onClick={syncAll} disabled={orderSyncing} className="gap-1">
            <RefreshCw className="h-4 w-4" /> Sync All
          </Button>
        </div>
      </div>

      {connectionOk !== null && (
        <Card className={`mb-4 border ${connectionOk ? "border-green-500/30 bg-green-500/5" : "border-destructive/30 bg-destructive/5"}`}>
          <CardContent className="flex items-center gap-2 py-3">
            {connectionOk ? (
              <><CheckCircle2 className="h-5 w-5 text-green-500" /> <span className="text-sm font-medium">Connected to B2B Wave successfully</span></>
            ) : (
              <><AlertCircle className="h-5 w-5 text-destructive" /> <span className="text-sm font-medium">Failed to connect — check your API credentials</span></>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {syncItems.map((item) => (
          <Card key={item.key}>
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <div className="rounded-lg bg-accent/10 p-2">
                <item.icon className="h-5 w-5 text-accent" />
              </div>
              <div className="flex-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  {item.label} {statusIcon(item.key)}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">{item.description}</p>
              {results[item.key] && (
                <p className={`mb-2 text-xs ${statuses[item.key] === "error" ? "text-destructive" : "text-green-600"}`}>
                  {results[item.key]}
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1"
                disabled={statuses[item.key] === "loading"}
                onClick={() => runSync(item)}
              >
                {statuses[item.key] === "loading" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Sync Now
              </Button>
            </CardContent>
          </Card>
        ))}

        {/* Orders - Special card with progress */}
        <Card className="sm:col-span-2 lg:col-span-3">
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <div className="rounded-lg bg-accent/10 p-2">
              <ShoppingCart className="h-5 w-5 text-accent" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base">Orders (Full History)</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Sync ALL orders from B2B Wave history. Processes 50 orders per batch to avoid timeouts.
              </p>
            </div>
          </CardHeader>
          <CardContent>
            {orderProgress && (
              <div className="mb-3 rounded-md bg-muted/50 p-3 text-sm">
                <p>{orderProgress}</p>
                {orderSyncing && (
                  <div className="mt-2 grid grid-cols-4 gap-4 text-xs text-muted-foreground">
                    <span>New: <strong className="text-foreground">{orderTotalSynced}</strong></span>
                    <span>Skipped: <strong className="text-foreground">{orderTotalSkipped}</strong></span>
                    <span>Items: <strong className="text-foreground">{orderTotalItems}</strong></span>
                    <span>Errors: <strong className="text-foreground">{orderTotalErrors}</strong></span>
                  </div>
                )}
                {orderSyncing && <Progress className="mt-2" value={undefined} />}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={orderSyncing}
                onClick={syncAllOrders}
              >
                {orderSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {orderSyncing ? "Syncing..." : "Sync All Orders"}
              </Button>
              {orderSyncing && (
                <Button variant="destructive" size="sm" className="gap-1" onClick={stopOrderSync}>
                  <StopCircle className="h-3 w-3" /> Stop
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Sync Notes</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>• <strong>Products</strong> are matched by SKU — existing products are updated, new ones are created.</p>
          <p>• <strong>Categories, Brands, Price Lists</strong> are matched by name.</p>
          <p>• <strong>Sales Reps</strong> are matched by email.</p>
          <p>• <strong>Customers</strong> are synced with price list and sales rep mapping.</p>
          <p>• <strong>Orders</strong> are synced page by page (500 per API page, 50 per batch) to handle large datasets.</p>
          <p>• The B2B Wave API contains <strong>32,000+</strong> historical orders. Full sync may take 30-60 minutes.</p>
        </CardContent>
      </Card>
    </AdminLayout>
  );
};

export default B2BWaveSync;
