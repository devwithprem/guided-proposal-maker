import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/quoteflow/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar, CreditCard, Database, Mail, MessageSquare, Table2, Webhook, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const Route = createFileRoute("/connections")({
  head: () => ({
    meta: [
      { title: "Connections — QuoteFlow" },
      { name: "description", content: "Push enquiries, quotes and proposals into the tools your business already runs on." },
      { property: "og:title", content: "Connections — QuoteFlow" },
      { property: "og:description", content: "Push enquiries, quotes and proposals into the tools your business already runs on." },
    ],
  }),
  component: ConnectionsPage,
});

interface Conn {
  id: string;
  name: string;
  blurb: string;
  icon: LucideIcon;
  category: string;
}

const catalog: Conn[] = [
  { id: "crm", name: "HubSpot CRM", blurb: "Create a deal when an enquiry is qualified.", icon: Database, category: "CRM" },
  { id: "sheets", name: "Google Sheets", blurb: "Append every submission to a spreadsheet.", icon: Table2, category: "Data" },
  { id: "email", name: "Email (SMTP)", blurb: "Send proposals straight from your domain.", icon: Mail, category: "Messaging" },
  { id: "cal", name: "Google Calendar", blurb: "Block dates when a proposal is accepted.", icon: Calendar, category: "Scheduling" },
  { id: "stripe", name: "Stripe", blurb: "Collect a deposit on proposal acceptance.", icon: CreditCard, category: "Payments" },
  { id: "slack", name: "Slack", blurb: "Ping a channel on every new enquiry.", icon: MessageSquare, category: "Messaging" },
  { id: "zapier", name: "Zapier", blurb: "Connect QuoteFlow to 6,000+ apps.", icon: Zap, category: "Automation" },
  { id: "webhook", name: "Webhook", blurb: "POST the full quote payload anywhere.", icon: Webhook, category: "Developer" },
];

function ConnectionsPage() {
  const [connected, setConnected] = useState<string[]>(["sheets", "email"]);
  const toggle = (id: string) =>
    setConnected((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <AppShell>
      <PageHeader
        title="Connections"
        description="Send enquiries, quotes and proposals wherever your team already works."
      />
      <div className="p-6">
        <div className="qf-card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[13.5px] font-semibold">Embed a flow on your website</p>
            <p className="text-[12.5px] text-muted-foreground">Drop this snippet anywhere to start collecting enquiries.</p>
          </div>
          <Input
            readOnly
            value='<script src="https://cdn.quoteflow.app/embed.js" data-flow="event-rental"></script>'
            className="font-mono text-[11.5px] sm:w-[440px]"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {catalog.map((c) => {
            const Icon = c.icon;
            const on = connected.includes(c.id);
            return (
              <div key={c.id} className="qf-card flex items-start gap-3 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Icon className="h-4.5 w-4.5 text-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13.5px] font-semibold">{c.name}</p>
                    {on && (
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-brand">
                        Connected
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">{c.blurb}</p>
                  <Button
                    size="sm"
                    variant={on ? "outline" : "default"}
                    className="mt-3 h-7 text-[12px]"
                    onClick={() => toggle(c.id)}
                  >
                    {on ? "Disconnect" : "Connect"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
