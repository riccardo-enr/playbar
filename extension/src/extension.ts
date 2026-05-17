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
import { NowPlaying, PlayerEntry, PlayersEvent } from "./types";

interface RuntimeBits {
  sidecar: Sidecar;
  statusBar: StatusBar;
  lastState: NowPlaying;
  lastPlayers: PlayersEvent;
}

let runtime: RuntimeBits | undefined;

export function activate(ctx: vscode.ExtensionContext) {
  const bring = () => boot(ctx);

  bring();

  ctx.subscriptions.push(
    vscode.commands.registerCommand("playbar.next", () =>
      runtime?.sidecar.send({ cmd: "next" }),
    ),
    vscode.commands.registerCommand("playbar.prev", () =>
      runtime?.sidecar.send({ cmd: "prev" }),
    ),
    vscode.commands.registerCommand("playbar.raise", () =>
      runtime?.sidecar.send({ cmd: "raise" }),
    ),
    vscode.commands.registerCommand("playbar.refresh", () =>
      runtime?.sidecar.send({ cmd: "refresh" }),
    ),
    vscode.commands.registerCommand("playbar.switchPlayer", () => switchPlayer()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("playbar")) {
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
  const cfg = vscode.workspace.getConfiguration("playbar");
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
    marqueeEnabled: cfg.get<boolean>("marquee.enabled", false),
    marqueeSpeedMs: cfg.get<number>("marquee.speedMs", 300),
    marqueePauseEndsMs: cfg.get<number>("marquee.pauseEndsMs", 1500),
    marqueeGap: cfg.get<string>("marquee.gap", "   "),
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
    (players) => {
      runtime!.lastPlayers = players;
    },
  );
  sidecar.start();
  runtime = {
    sidecar,
    statusBar,
    lastState: { status: "none" },
    lastPlayers: { players: [] },
  };
}

/*
 * Show a QuickPick of all currently known MPRIS players and forward the
 * user's choice to the sidecar as `select_player`. The selection is
 * transient: it does not write `playbar.preferredPlayer`, so a restart
 * returns to the configured auto-pick. Showing "(none)" lets the user
 * clear the override back to the default.
 */
async function switchPlayer() {
  if (!runtime) {
    return;
  }
  const players = runtime.lastPlayers.players;
  if (players.length === 0) {
    void vscode.window.showInformationMessage(
      "PlayBar: no media players are currently active.",
    );
    return;
  }
  const active = runtime.lastPlayers.active;
  type Pick = vscode.QuickPickItem & { id: string | null };
  const items: Pick[] = players.map((p: PlayerEntry) => ({
    id: p.id,
    label: p.id === active ? `$(check) ${p.id}` : `    ${p.id}`,
    description: describe(p),
  }));
  if (players.length > 1) {
    items.push({ id: null, label: "$(circle-slash) (auto / clear preference)" });
  }
  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: "Switch active media player",
    matchOnDescription: true,
  });
  if (!choice) {
    return;
  }
  runtime.sidecar.send({ cmd: "select_player", name: choice.id });
}

function describe(p: PlayerEntry): string {
  const bits: string[] = [p.status];
  if (p.artist) {
    bits.push(p.artist);
  }
  if (p.title) {
    bits.push(p.title);
  }
  return bits.join(" - ");
}

function teardown() {
  if (!runtime) {
    return;
  }
  runtime.sidecar.dispose();
  runtime.statusBar.dispose();
  runtime = undefined;
}
