/*
 * Sidecar lifecycle: spawn the `playbar` Rust binary, parse its
 * NDJSON stdout into typed events, restart with capped exponential
 * backoff if it exits, and forward shutdown via SIGTERM on dispose.
 *
 * Stderr is piped into a VSCode OutputChannel so users can debug
 * D-Bus errors without leaving the editor.
 */

import { ChildProcess, spawn } from "child_process";
import * as path from "path";
import * as readline from "readline";
import * as vscode from "vscode";

import { Command, Message, NowPlaying, PlayersEvent } from "./types";

export type StateListener = (state: NowPlaying) => void;
export type PlayersListener = (players: PlayersEvent) => void;

export class Sidecar implements vscode.Disposable {
  private proc?: ChildProcess;
  private restartDelayMs = 500;
  private disposed = false;
  private readonly output: vscode.OutputChannel;

  constructor(
    private readonly binaryPath: string,
    private readonly preferredPlayer: string,
    private readonly onState: StateListener,
    private readonly onPlayers: PlayersListener = () => {},
  ) {
    this.output = vscode.window.createOutputChannel("Now Playing");
  }

  start() {
    if (this.disposed) {
      return;
    }
    const args: string[] = [];
    if (this.preferredPlayer) {
      args.push("--player", this.preferredPlayer);
    }
    this.output.appendLine(`spawning ${this.binaryPath} ${args.join(" ")}`);
    const proc = spawn(this.binaryPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc = proc;

    if (!proc.stdout || !proc.stderr) {
      this.output.appendLine("sidecar missing stdio");
      return;
    }

    const lines = readline.createInterface({ input: proc.stdout });
    lines.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      try {
        const msg = JSON.parse(trimmed) as Message;
        switch (msg.kind) {
          case "now_playing": {
            const { kind: _kind, ...state } = msg;
            this.onState(state);
            break;
          }
          case "players": {
            const { kind: _kind, ...players } = msg;
            this.onPlayers(players);
            break;
          }
          default:
            this.output.appendLine(`unknown event kind: ${trimmed}`);
        }
        this.restartDelayMs = 500;
      } catch (e) {
        this.output.appendLine(`bad event: ${trimmed} (${(e as Error).message})`);
      }
    });

    readline.createInterface({ input: proc.stderr }).on("line", (line) => {
      this.output.appendLine(`[sidecar] ${line}`);
    });

    proc.on("error", (err) => {
      this.output.appendLine(`spawn error: ${err.message}`);
      this.scheduleRestart();
    });
    proc.on("exit", (code, signal) => {
      this.output.appendLine(`sidecar exited code=${code} signal=${signal}`);
      this.proc = undefined;
      this.scheduleRestart();
    });
  }

  send(cmd: Command) {
    const stdin = this.proc?.stdin;
    if (!stdin || stdin.destroyed) {
      this.output.appendLine(`drop command (no sidecar): ${JSON.stringify(cmd)}`);
      return;
    }
    stdin.write(JSON.stringify(cmd) + "\n");
  }

  dispose() {
    this.disposed = true;
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = undefined;
    }
    this.output.dispose();
  }

  private scheduleRestart() {
    if (this.disposed) {
      return;
    }
    const delay = this.restartDelayMs;
    this.restartDelayMs = Math.min(this.restartDelayMs * 2, 30_000);
    setTimeout(() => this.start(), delay);
  }
}

export function resolveBinaryPath(extensionPath: string, override: string): string {
  if (override) {
    return override;
  }
  // Bundled binary lives under bin/<platform>-<arch>/playbar[.exe].
  const triple = `${process.platform}-${process.arch}`;
  const exe = process.platform === "win32" ? "playbar.exe" : "playbar";
  return path.join(extensionPath, "bin", triple, exe);
}
