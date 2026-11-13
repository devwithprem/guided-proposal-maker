import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  getSnapshot,
  getServerSnapshot,
  getServerSyncStatusSnapshot,
  getSyncStatus,
  setSyncStatus,
  storeSubscribe,
  useSyncStatus,
  useWorkspace,
} from "../store";
import { isAuthConfigured, verifyAdminPasscode } from "../server/auth.server";
import { PageHeader } from "@/components/quoteflow/AppShell";

function TestConsumer({ onRender }: { onRender?: (renderCount: number) => void }) {
  const sync = useSyncStatus();
  const ws = useWorkspace();
  const renderCountRef = React.useRef(0);
  renderCountRef.current += 1;
  if (onRender) onRender(renderCountRef.current);

  return (
    <div data-testid="test-consumer">
      <span data-testid="status">{sync.syncStatus}</span>
      <span data-testid="workspace">{ws.settings?.businessName ?? "QuoteFlow"}</span>
      <span data-testid="renders">{renderCountRef.current}</span>
    </div>
  );
}

describe("QuoteFlow — Task A: useSyncExternalStore Snapshot Stability Regression", () => {
  beforeEach(() => {
    setSyncStatus("idle", null);
  });

  it("Scenario 1: getSyncStatus returns stable cached reference across multiple calls", () => {
    const snap1 = getSyncStatus();
    const snap2 = getSyncStatus();
    const snap3 = getSyncStatus();

    expect(Object.is(snap1, snap2)).toBe(true);
    expect(Object.is(snap2, snap3)).toBe(true);
  });

  it("Scenario 2: getServerSyncStatusSnapshot returns constant frozen reference across calls", () => {
    const serverSnap1 = getServerSyncStatusSnapshot();
    const serverSnap2 = getServerSyncStatusSnapshot();

    expect(Object.is(serverSnap1, serverSnap2)).toBe(true);
    expect(serverSnap1.syncStatus).toBe("idle");
    expect(serverSnap1.lastSyncError).toBe(null);
  });

  it("Scenario 3: getServerSnapshot for useWorkspace returns stable reference", () => {
    const snap1 = getServerSnapshot();
    const snap2 = getServerSnapshot();

    expect(Object.is(snap1, snap2)).toBe(true);
    expect(snap1.flows).toBeDefined();
  });

  it("Scenario 4: Mounted React consumer renders via SSR without getServerSnapshot caching error", () => {
    let renderCount = 0;
    const html = renderToString(<TestConsumer onRender={(c) => { renderCount = c; }} />);

    expect(html).toContain("test-consumer");
    expect(html).toContain("idle");
    expect(renderCount).toBe(1);
  });

  it("Scenario 5: PageHeader renders without infinite render loop or maximum update depth exceeded", () => {
    const html = renderToString(
      <PageHeader
        title="Turn enquiries into quotes in minutes."
        description="Test PageHeader SSR stability"
      />,
    );

    expect(html).toContain("Turn enquiries into quotes in minutes.");
    expect(html).toContain("Test PageHeader SSR stability");
  });

  it("Scenario 6: setSyncStatus updates snapshot reference only when values change", () => {
    const snapBefore = getSyncStatus();

    // No-op update with identical values returns same reference
    setSyncStatus("idle", null);
    const snapAfterNoop = getSyncStatus();
    expect(Object.is(snapBefore, snapAfterNoop)).toBe(true);

    // Actual change produces new stable reference
    setSyncStatus("syncing", null);
    const snapSyncing1 = getSyncStatus();
    const snapSyncing2 = getSyncStatus();

    expect(Object.is(snapBefore, snapSyncing1)).toBe(false);
    expect(Object.is(snapSyncing1, snapSyncing2)).toBe(true);
    expect(snapSyncing1.syncStatus).toBe("syncing");

    // Setting error produces another stable reference
    setSyncStatus("error", "Database timeout");
    const snapError1 = getSyncStatus();
    const snapError2 = getSyncStatus();

    expect(Object.is(snapSyncing1, snapError1)).toBe(false);
    expect(Object.is(snapError1, snapError2)).toBe(true);
    expect(snapError1.syncStatus).toBe("error");
    expect(snapError1.lastSyncError).toBe("Database timeout");
  });

  it("Scenario 7: Client subscriber receives notifications and reads updated snapshot on state transitions", () => {
    let subscriberNotified = 0;
    const unsubscribe = storeSubscribe(() => {
      subscriberNotified += 1;
    });

    setSyncStatus("idle", null);
    expect(getSyncStatus().syncStatus).toBe("idle");

    setSyncStatus("syncing", null);
    expect(subscriberNotified).toBe(1);
    expect(getSyncStatus().syncStatus).toBe("syncing");

    setSyncStatus("error", "Connection lost");
    expect(subscriberNotified).toBe(2);
    expect(getSyncStatus().syncStatus).toBe("error");
    expect(getSyncStatus().lastSyncError).toBe("Connection lost");

    unsubscribe();
  });

  it("Scenario 8: Auth fail-safe: isAuthConfigured detects missing environment variables without crashing", () => {
    const origCode = process.env["QUOTEFLOW_ADMIN_PASSCODE"];
    const origSecret = process.env["QUOTEFLOW_SESSION_SECRET"];

    delete process.env["QUOTEFLOW_ADMIN_PASSCODE"];
    delete process.env["QUOTEFLOW_SESSION_SECRET"];

    expect(isAuthConfigured()).toBe(false);
    expect(verifyAdminPasscode("any-passcode")).toBe(false);

    process.env["QUOTEFLOW_ADMIN_PASSCODE"] = "my-secret-pass";
    expect(isAuthConfigured()).toBe(false); // still needs session secret

    process.env["QUOTEFLOW_SESSION_SECRET"] = "my-long-session-secret-at-least-32-chars";
    expect(isAuthConfigured()).toBe(true);
    expect(verifyAdminPasscode("my-secret-pass")).toBe(true);
    expect(verifyAdminPasscode("wrong-pass")).toBe(false);

    if (origCode) process.env["QUOTEFLOW_ADMIN_PASSCODE"] = origCode;
    if (origSecret) process.env["QUOTEFLOW_SESSION_SECRET"] = origSecret;
  });
});
