/*
 * Extension entry point.
 *
 * On activation: resolve the sidecar binary path, spawn it, and wire
 * its events into a `StatusBar`. Register VSCode commands that
 * forward into the sidecar's stdin. On config change, reload anything
 * that changed without bouncing the sidecar when possible
 * (format/length/showControls are TS-side; preferred player and
 * binary path require a restart).
 */

import * as vscode from "vscode";

import { resolveBinaryPath, Sidecar } from "./sidecar";
import { FormatRule } from "./format";
import { StatusBar, StatusBarOptions } from "./statusbar";
import { NowPlaying } from "./types";

interface RuntimeBits {
  sidecar: Sidecar;
  statusBar: StatusBar;
  lastState: NowPlaying;
}

let runtime: RuntimeBits | undefined;

export function activate(ctx: vscode.ExtensionContext) {
  const bring = () => boot(ctx);

  bring();

  ctx.subscriptions.push(
    vscode.commands.registerCommand("nowPlaying.next", () =>
      runtime?.sidecar.send({ cmd: "next" }),
    ),
    vscode.commands.registerCommand("nowPlaying.prev", () =>
      runtime?.sidecar.send({ cmd: "prev" }),
    ),
    vscode.commands.registerCommand("nowPlaying.raise", () =>
      runtime?.sidecar.send({ cmd: "raise" }),
    ),
    vscode.commands.registerCommand("nowPlaying.refresh", () =>
      runtime?.sidecar.send({ cmd: "refresh" }),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("nowPlaying")) {
        return;
      }
      teardown();
      bring();
    }),
  );
}

export function deactivate() {
  teardown();
}

function boot(ctx: vscode.ExtensionContext) {
  const cfg = vscode.workspace.getConfiguration("nowPlaying");
  const opts: StatusBarOptions = {
    alignment: cfg.get<"left" | "right">("alignment", "right"),
    priority: cfg.get<number>("priority", 100),
    template: cfg.get<string>("format", "{playerIcon} {artist} - {title}"),
    maxLength: cfg.get<number>("maxLength", 50),
    showControls: cfg.get<boolean>("showControls", true),
    hidePausedAfterSeconds: cfg.get<number>("hidePausedAfterSeconds", 0),
    hideIdleAfterSeconds: cfg.get<number>("hideIdleAfterSeconds", 0),
    playerIcons: cfg.get<Record<string, string>>("playerIcons", {}),
    formatRules: cfg.get<FormatRule[]>("formatRules", []),
  };
  const statusBar = new StatusBar(opts);
  const binary = resolveBinaryPath(ctx.extensionPath, cfg.get<string>("sidecarPath", ""));
  const sidecar = new Sidecar(
    binary,
    cfg.get<string>("preferredPlayer", ""),
    (state) => {
      runtime!.lastState = state;
      statusBar.render(state);
    },
  );
  sidecar.start();
  runtime = { sidecar, statusBar, lastState: { status: "none" } };
}

function teardown() {
  if (!runtime) {
    return;
  }
  runtime.sidecar.dispose();
  runtime.statusBar.dispose();
  runtime = undefined;
}
