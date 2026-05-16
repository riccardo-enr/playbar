/*
 * Status bar rendering. Holds the main "now playing" item plus
 * optional prev / play-pause / next control items. Items are hidden
 * when no media is available so they don't take space.
 */

import * as vscode from "vscode";

import { format } from "./format";
import { NowPlaying, Status } from "./types";

export interface StatusBarOptions {
  alignment: "left" | "right";
  priority: number;
  template: string;
  maxLength: number;
  showControls: boolean;
}

export class StatusBar implements vscode.Disposable {
  private readonly main: vscode.StatusBarItem;
  private readonly prev?: vscode.StatusBarItem;
  private readonly toggle?: vscode.StatusBarItem;
  private readonly next?: vscode.StatusBarItem;

  constructor(private readonly opts: StatusBarOptions) {
    const align = opts.alignment === "left"
      ? vscode.StatusBarAlignment.Left
      : vscode.StatusBarAlignment.Right;

    // On a right-aligned status bar, HIGHER priority sits closer to the
    // right edge. To render [title][prev][toggle][next] left-to-right,
    // title needs the lowest priority and next the highest.
    // Micro-fractional offsets keep the group contiguous so no other
    // extension can wedge an item between them.
    const p = opts.priority;
    this.main = vscode.window.createStatusBarItem("nowPlaying.main", align, p);
    this.main.name = "Now Playing";
    this.main.command = "nowPlaying.playPause";

    if (opts.showControls) {
      this.prev = vscode.window.createStatusBarItem("nowPlaying.prev", align, p + 1e-4);
      this.prev.name = "Now Playing: Previous";
      this.prev.text = "$(chevron-left)";
      this.prev.tooltip = "Previous track";
      this.prev.command = "nowPlaying.prev";

      this.toggle = vscode.window.createStatusBarItem("nowPlaying.toggle", align, p + 2e-4);
      this.toggle.name = "Now Playing: Play/Pause";
      this.toggle.command = "nowPlaying.playPause";

      this.next = vscode.window.createStatusBarItem("nowPlaying.next", align, p + 3e-4);
      this.next.name = "Now Playing: Next";
      this.next.text = "$(chevron-right)";
      this.next.tooltip = "Next track";
      this.next.command = "nowPlaying.next";
    }
  }

  render(state: NowPlaying) {
    if (state.status === "none" || (!state.title && !state.artist)) {
      this.hide();
      return;
    }

    this.main.text = format(state, this.opts.template, this.opts.maxLength);
    this.main.tooltip = buildTooltip(state);
    this.main.show();

    if (this.toggle) {
      this.toggle.text = state.status === "playing" ? "$(debug-pause)" : "$(play)";
      this.toggle.tooltip = state.status === "playing" ? "Pause" : "Play";
      this.toggle.show();
    }
    this.prev?.show();
    this.next?.show();
  }

  hide() {
    this.main.hide();
    this.prev?.hide();
    this.toggle?.hide();
    this.next?.hide();
  }

  dispose() {
    this.main.dispose();
    this.prev?.dispose();
    this.toggle?.dispose();
    this.next?.dispose();
  }
}

function buildTooltip(state: NowPlaying): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = false;
  if (state.title) {
    md.appendMarkdown(`**${escape(state.title)}**\n\n`);
  }
  if (state.artist) {
    md.appendMarkdown(`${escape(state.artist)}\n\n`);
  }
  if (state.album) {
    md.appendMarkdown(`_${escape(state.album)}_\n\n`);
  }
  if (state.duration_ms != null) {
    md.appendMarkdown(`${formatTime(state.position_ms ?? 0)} / ${formatTime(state.duration_ms)}\n\n`);
  }
  if (state.player) {
    md.appendMarkdown(`Player: \`${state.player}\` (${labelForStatus(state.status)})`);
  }
  return md;
}

function escape(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|]/g, (c) => `\\${c}`);
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function labelForStatus(s: Status): string {
  switch (s) {
    case "playing": return "playing";
    case "paused": return "paused";
    case "stopped": return "stopped";
    default: return "idle";
  }
}
