import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { DesignWorkspace } from "../src/designWorkspace";

/** Observe the shipped Webview's existing protocol; never inject a UI script. */
export async function observeNativeDesignStartup(workspace: DesignWorkspace) {
  const events: {
    id: string;
    action: string;
    elapsedMs: number;
    projectKey?: string;
    generation?: number;
    canvasCount?: number;
    completed?: boolean;
    error?: string;
  }[] = [];
  const started = Date.now();
  const original = workspace.handleRequest;
  // This read-through observer runs only in the separate test driver. The
  // installed host, Webview HTML/CSP, JS, CSS and message receiver are unchanged.
  workspace.handleRequest = async function (raw: unknown) {
    const request = raw as {
      id: string;
      action: string;
      payload?: {
        projectKey?: string;
        generation?: number;
        patch?: { canvases?: unknown[] };
      };
    };
    const event = {
      id: request.id,
      action: request.action,
      elapsedMs: Date.now() - started,
      projectKey: request.payload?.projectKey,
      generation: request.payload?.generation,
      canvasCount: request.payload?.patch?.canvases?.length,
    } as (typeof events)[number];
    events.push(event);
    try {
      const result = await original.call(this, raw);
      event.completed = true;
      return result;
    } catch (error) {
      event.error = String(error);
      throw error;
    }
  };
  async function waitFor(test: () => boolean, label: string) {
    const deadline = Date.now() + 45000;
    while (!test()) {
      if (Date.now() > deadline)
        throw Error(
          `Native Webview timeout: ${label}; ${JSON.stringify(events)}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    // No direct handleRequest calls are made during this observation window.
    await vscode.commands.executeCommand("pureobom.openWorkspace");
    await waitFor(
      () => events.some((event) => event.action === "ready" && event.completed),
      "shipped React entry requests ready through acquireVsCodeApi",
    );
    await waitFor(
      () =>
        events.some(
          (event) =>
            event.action === "saveNavigation" &&
            event.completed &&
            event.projectKey === workspace.state.projectKey &&
            event.generation === workspace.state.navigation?.generation &&
            (event.canvasCount ?? 0) > 0,
        ),
      "native canvas receives the host graph and persists its initial fit",
    );
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(tab?.input instanceof vscode.TabInputWebview);
    assert.equal(tab.label, "풀어봄 · 시스템 설계");
    const viewType = tab.input.viewType;
    const before = JSON.stringify(workspace.state.specs);
    const navigation = JSON.stringify(workspace.state.navigation?.view);
    assert.equal(workspace.state.job, undefined);
    const firstReadyCount = events.filter(
      (event) => event.action === "ready",
    ).length;
    assert.equal(await vscode.window.tabGroups.close(tab), true);
    await vscode.commands.executeCommand("pureobom.openWorkspace");
    await waitFor(
      () =>
        events.filter((event) => event.action === "ready" && event.completed)
          .length > firstReadyCount,
      "closing and reopening the actual Webview creates a fresh ready request",
    );
    assert.equal(JSON.stringify(workspace.state.specs), before);
    assert.equal(JSON.stringify(workspace.state.navigation?.view), navigation);
    assert.equal(workspace.state.job, undefined);
    assert.ok(
      events.every((event) =>
        ["ready", "saveNavigation"].includes(event.action),
      ),
    );
    assert.ok(events.every((event) => !event.error));
    return {
      scope:
        "Unmodified installed native VS Code Webview boot and protocol round trip, observed through its existing host dispatcher. No DOM injection, browser replacement, pointer/keyboard input, visual assertion or model execution.",
      viewType,
      events,
      closedAndReopened: true,
      navigationPreserved: true,
      designPreserved: true,
      implementationJobsStarted: 0,
    };
  } finally {
    workspace.handleRequest = original;
  }
}
