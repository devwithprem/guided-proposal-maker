import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/quoteflow/AppShell";
import { useActions, useWorkspace } from "@/lib/quoteflow/store";
import { uid } from "@/lib/quoteflow/seed";
import { money } from "@/lib/quoteflow/engine";
import type { Package } from "@/lib/quoteflow/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Archive, Check, Copy, Pencil, Plus, X } from "lucide-react";

export const Route = createFileRoute("/packages")({
  head: () => ({
    meta: [
      { title: "Packages — QuoteFlow" },
      { name: "description", content: "Bundle your services into packages with optional add-ons and clear pricing." },
      { property: "og:title", content: "Packages — QuoteFlow" },
      { property: "og:description", content: "Bundle your services into packages with optional add-ons and clear pricing." },
    ],
  }),
  component: PackagesPage,
});

function blankPackage(): Package {
  return {
    id: uid("pk"),
    name: "New package",
    description: "",
    price: 0,
    includes: ["What's included"],
    addons: [],
    archived: false,
  };
}

function PackagesPage() {
  const ws = useWorkspace();
  const { upsertPackage } = useActions();
  const [editing, setEditing] = useState<Package | null>(null);

  return (
    <AppShell>
      <PageHeader
        title="Packages"
        description="Bundles of work you sell, with optional add-ons customers can pick."
        actions={
          <Button size="sm" onClick={() => setEditing(blankPackage())}>
            <Plus className="mr-1 h-4 w-4" /> New Package
          </Button>
        }
      />
      <div className="grid gap-3 p-6 lg:grid-cols-2 xl:grid-cols-3">
        {ws.packages.map((p) => (
          <div key={p.id} className={p.archived ? "qf-card p-4 opacity-60" : "qf-card p-4"}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[14.5px] font-semibold">{p.name}</h3>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">{p.description}</p>
              </div>
              <span className="shrink-0 text-[17px] font-semibold tabular-nums">{money(p.price)}</span>
            </div>

            <p className="qf-label mt-4">Includes</p>
            <ul className="mt-1.5 space-y-1 text-[13px]">
              {p.includes.map((i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" /> {i}
                </li>
              ))}
            </ul>

            {p.addons.length > 0 && (
              <>
                <p className="qf-label mt-4">Optional add-ons</p>
                <ul className="mt-1.5 space-y-1 text-[13px] text-muted-foreground">
                  {p.addons.map((a) => (
                    <li key={a.id} className="flex justify-between">
                      <span>{a.name}</span>
                      <span className="tabular-nums">{money(a.price)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="mt-4 flex items-center gap-1 border-t border-border pt-3">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => setEditing(p)}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[12px]"
                onClick={() => upsertPackage({ ...structuredClone(p), id: uid("pk"), name: `${p.name} copy` })}
              >
                <Copy className="mr-1 h-3.5 w-3.5" /> Duplicate
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[12px]"
                onClick={() => upsertPackage({ ...p, archived: !p.archived })}
              >
                <Archive className="mr-1 h-3.5 w-3.5" /> {p.archived ? "Restore" : "Archive"}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.name}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div>
                <p className="qf-label mb-1">Name</p>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <p className="qf-label mb-1">Description</p>
                <Textarea
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </div>
              <div>
                <p className="qf-label mb-1">Price</p>
                <Input
                  type="number"
                  value={editing.price}
                  onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })}
                />
              </div>
              <div>
                <p className="qf-label mb-1">Includes</p>
                <div className="space-y-1.5">
                  {editing.includes.map((line, i) => (
                    <div key={i} className="flex gap-1.5">
                      <Input
                        value={line}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            includes: editing.includes.map((x, xi) => (xi === i ? e.target.value : x)),
                          })
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditing({ ...editing, includes: editing.includes.filter((_, xi) => xi !== i) })}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-7 text-[12px] text-brand hover:text-brand"
                  onClick={() => setEditing({ ...editing, includes: [...editing.includes, ""] })}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add line
                </Button>
              </div>
              <div>
                <p className="qf-label mb-1">Optional add-ons</p>
                <div className="space-y-1.5">
                  {editing.addons.map((a) => (
                    <div key={a.id} className="flex gap-1.5">
                      <Input
                        value={a.name}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            addons: editing.addons.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)),
                          })
                        }
                      />
                      <Input
                        type="number"
                        className="w-[110px]"
                        value={a.price}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            addons: editing.addons.map((x) => (x.id === a.id ? { ...x, price: Number(e.target.value) } : x)),
                          })
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditing({ ...editing, addons: editing.addons.filter((x) => x.id !== a.id) })}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-7 text-[12px] text-brand hover:text-brand"
                  onClick={() =>
                    setEditing({ ...editing, addons: [...editing.addons, { id: uid("a"), name: "New add-on", price: 0 }] })
                  }
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add add-on
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editing) upsertPackage(editing);
                setEditing(null);
              }}
            >
              Save package
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
