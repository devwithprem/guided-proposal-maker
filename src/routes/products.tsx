import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/quoteflow/AppShell";
import { useActions, useWorkspace } from "@/lib/quoteflow/store";
import { uid } from "@/lib/quoteflow/seed";
import { money } from "@/lib/quoteflow/engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/products")({
  head: () => ({
    meta: [
      { title: "Products — QuoteFlow" },
      { name: "description", content: "Your catalog of services, fees and add-ons used across every quote." },
      { property: "og:title", content: "Products — QuoteFlow" },
      { property: "og:description", content: "Your catalog of services, fees and add-ons used across every quote." },
    ],
  }),
  component: ProductsPage,
});

function ProductsPage() {
  const ws = useWorkspace();
  const { upsertProduct, deleteProduct } = useActions();

  return (
    <AppShell>
      <PageHeader
        title="Products"
        description="Everything your rules can recommend, add or charge for."
        actions={
          <Button
            size="sm"
            onClick={() =>
              upsertProduct({
                id: uid("p"),
                name: "New product",
                sku: "SKU-000",
                description: "",
                price: 0,
                unit: "flat",
                category: "General",
                active: true,
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" /> New Product
          </Button>
        }
      />
      <div className="p-6">
        <div className="qf-card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Price</th>
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {ws.products.map((p) => (
                <tr key={p.id} className="border-b border-border/70 last:border-0">
                  <td className="px-3 py-1.5">
                    <Input
                      className="h-8 border-transparent bg-transparent text-[13px] font-medium hover:border-border"
                      value={p.name}
                      onChange={(e) => upsertProduct({ ...p, name: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      className="h-8 w-[110px] border-transparent bg-transparent font-mono text-[12px] hover:border-border"
                      value={p.sku}
                      onChange={(e) => upsertProduct({ ...p, sku: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      className="h-8 border-transparent bg-transparent text-[12.5px] text-muted-foreground hover:border-border"
                      value={p.description}
                      onChange={(e) => upsertProduct({ ...p, description: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      type="number"
                      className="h-8 w-[92px] border-transparent bg-transparent text-[13px] tabular-nums hover:border-border"
                      value={p.price}
                      onChange={(e) => upsertProduct({ ...p, price: Number(e.target.value) })}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      className="h-8 w-[110px] border-transparent bg-transparent text-[12.5px] hover:border-border"
                      value={p.unit}
                      onChange={(e) => upsertProduct({ ...p, unit: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <Input
                      className="h-8 w-[120px] border-transparent bg-transparent text-[12.5px] hover:border-border"
                      value={p.category}
                      onChange={(e) => upsertProduct({ ...p, category: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <Switch checked={p.active} onCheckedChange={(v) => upsertProduct({ ...p, active: v })} />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:text-destructive"
                      onClick={() => deleteProduct(p.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground">
          {ws.products.length} items · catalog value {money(ws.products.reduce((s, p) => s + p.price, 0))}
        </p>
      </div>
    </AppShell>
  );
}
