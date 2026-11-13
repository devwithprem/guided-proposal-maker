import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/quoteflow/AppShell";
import { resetWorkspace, useActions, useWorkspace } from "@/lib/quoteflow/store";
import { defaultWorkspaceSettings } from "@/lib/quoteflow/defaults";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RotateCcw } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — QuoteFlow" },
      { name: "description", content: "Workspace branding, quote defaults and proposal terms for your business." },
      { property: "og:title", content: "Settings — QuoteFlow" },
      { property: "og:description", content: "Workspace branding, quote defaults and proposal terms for your business." },
    ],
  }),
  component: SettingsPage,
});

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="qf-card p-5">
      <p className="text-[13.5px] font-semibold">{title}</p>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[190px_1fr] sm:items-center sm:gap-4">
      <p className="qf-label">{label}</p>
      {children}
    </div>
  );
}

function SettingsPage() {
  const ws = useWorkspace();
  const { updateSettings } = useActions();
  const s = ws.settings ?? defaultWorkspaceSettings();

  return (
    <AppShell>
      <PageHeader title="Settings" description="Workspace, quote defaults and proposal terms." />
      <div className="grid max-w-3xl gap-4 p-6">
        <Section title="Workspace" description="How your business appears on customer-facing flows and proposals.">
          <Field label="Business name">
            <Input
              value={s.businessName}
              onChange={(e) => updateSettings({ businessName: e.target.value })}
            />
          </Field>
          <Field label="Reply-to email">
            <Input
              value={s.replyToEmail}
              onChange={(e) => updateSettings({ replyToEmail: e.target.value })}
            />
          </Field>
          <Field label="Currency">
            <Select
              value={s.currency}
              onValueChange={(c) => updateSettings({ currency: c as "USD" | "GBP" | "EUR" | "AUD" | "CAD" })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["USD", "GBP", "EUR", "AUD", "CAD"].map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Section>

        <Section title="Quote defaults" description="Applied to every new flow unless overridden.">
          <Field label="Deposit (%)">
            <Input
              type="number"
              value={s.depositPercent}
              onChange={(e) => updateSettings({ depositPercent: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Quote validity (days)">
            <Input
              type="number"
              value={s.validityDays}
              onChange={(e) => updateSettings({ validityDays: Number(e.target.value) || 14 })}
            />
          </Field>
          <Field label="Auto-quote on submit">
            <div className="flex items-center gap-2">
              <Switch
                checked={s.autoQuote}
                onCheckedChange={(autoQuote) => updateSettings({ autoQuote })}
              />
              <span className="text-[12.5px] text-muted-foreground">Run pricing logic the moment an enquiry arrives.</span>
            </div>
          </Field>
          <Field label="Email me new enquiries">
            <div className="flex items-center gap-2">
              <Switch
                checked={s.notifyOnSubmit}
                onCheckedChange={(notifyOnSubmit) => updateSettings({ notifyOnSubmit })}
              />
              <span className="text-[12.5px] text-muted-foreground">Instant notification to your reply-to address.</span>
            </div>
          </Field>
        </Section>

        <Section title="Proposal terms" description="Shown at the bottom of every proposal you send.">
          <Textarea
            rows={4}
            value={s.terms}
            onChange={(e) => updateSettings({ terms: e.target.value })}
          />
        </Section>

        <Section
          title="Demo data"
          description={`Shared server SQLite database: ${ws.flows.length} flows, ${ws.products.length} products, ${ws.enquiries.length} enquiries.`}
        >
          <Button variant="outline" size="sm" onClick={() => resetWorkspace()}>
            <RotateCcw className="mr-1 h-4 w-4" /> Reset to sample data
          </Button>
        </Section>
      </div>
    </AppShell>
  );
}
