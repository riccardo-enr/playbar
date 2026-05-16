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
  hidePausedAfterSeconds: number;
  hideIdleAfterSeconds: number;
}

export class StatusBar implements vscode.Disposable {
  private readonly main: vscode.StatusBarItem;
  private readonly prev?: vscode.StatusBarItem;
  private readonly toggle?: vscode.StatusBarItem;
  private readonly next?: vscode.StatusBarItem;
  private lastTooltipKey: string = "";
  private hideTimer: NodeJS.Timeout | undefined;
  private lastStatus: Status | undefined;
  private autoHidden = false;

  constructor(private readonly opts: StatusBarOptions) {
    const align = opts.alignment === "left"
      ? vscode.StatusBarAlignment.Left
      : vscode.StatusBarAlignment.Right;

    // Higher priority renders further to the left within an alignment
    // group, so to display [title][prev][toggle][next] left-to-right
    // title needs the highest priority and next the lowest.
    // Micro-fractional offsets keep the group contiguous so no other
    // extension can wedge an item between them.
    const p = opts.priority;
    this.main = vscode.window.createStatusBarItem("nowPlaying.main", align, p + 3e-4);
    this.main.name = "Now Playing";
    this.main.command = "nowPlaying.raise";

    if (opts.showControls) {
      this.prev = vscode.window.createStatusBarItem("nowPlaying.prev", align, p + 2e-4);
      this.prev.name = "Now Playing: Previous";
      this.prev.text = "$(chevron-left)";
      this.prev.tooltip = "Previous track";
      this.prev.command = "nowPlaying.prev";

      this.toggle = vscode.window.createStatusBarItem("nowPlaying.toggle", align, p + 1e-4);
      this.toggle.name = "Now Playing: Play/Pause";
      this.toggle.command = "nowPlaying.playPause";

      this.next = vscode.window.createStatusBarItem("nowPlaying.next", align, p);
      this.next.name = "Now Playing: Next";
      this.next.text = "$(chevron-right)";
      this.next.tooltip = "Next track";
      this.next.command = "nowPlaying.next";
    }
  }

  render(state: NowPlaying) {
    if (state.status === "none" || (!state.title && !state.artist)) {
      this.hide();
      this.lastStatus = state.status;
      this.autoHidden = false;
      return;
    }

    const statusChanged = state.status !== this.lastStatus;

    // Once the auto-hide timer has fired, stay hidden until playback status
    // actually changes. Otherwise periodic metadata frames from the player
    // would re-show the bar on every D-Bus PropertiesChanged.
    if (this.autoHidden && !statusChanged) {
      return;
    }

    this.main.text = format(state, this.opts.template, this.opts.maxLength);
    const key = tooltipKey(state);
    if (key !== this.lastTooltipKey) {
      this.main.tooltip = buildTooltip(state);
      this.lastTooltipKey = key;
    }
    this.main.show();

    if (this.toggle) {
      this.toggle.text = state.status === "playing" ? "$(debug-pause)" : "$(play)";
      this.toggle.tooltip = state.status === "playing" ? "Pause" : "Play";
      this.toggle.show();
    }
    this.prev?.show();
    this.next?.show();

    if (statusChanged) {
      this.autoHidden = false;
      switch (state.status) {
        case "playing":
          this.clearHideTimer();
          break;
        case "paused":
          this.scheduleHide(this.opts.hidePausedAfterSeconds);
          break;
        case "stopped":
          this.scheduleHide(this.opts.hideIdleAfterSeconds);
          break;
      }
      this.lastStatus = state.status;
    }
  }

  hide() {
    this.clearHideTimer();
    this.main.hide();
    this.prev?.hide();
    this.toggle?.hide();
    this.next?.hide();
  }

  dispose() {
    this.clearHideTimer();
    this.main.dispose();
    this.prev?.dispose();
    this.toggle?.dispose();
    this.next?.dispose();
  }

  private clearHideTimer() {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = undefined;
    }
  }

  private scheduleHide(seconds: number) {
    this.clearHideTimer();
    if (seconds <= 0) {
      return;
    }
    this.hideTimer = setTimeout(() => {
      this.autoHidden = true;
      this.hide();
    }, seconds * 1000);
  }
}

function buildTooltip(state: NowPlaying): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = false;
  md.supportHtml = true;
  if (state.art_url) {
    md.appendMarkdown(`<img src="${state.art_url}" width="180" height="180" />\n\n`);
  }
  if (state.title) {
    md.appendMarkdown(`**${escape(state.title)}**\n\n`);
  }
  if (state.artist) {
    md.appendMarkdown(`${escape(state.artist)}\n\n`);
  }
  if (state.album) {
    md.appendMarkdown(`_${escape(state.album)}_\n\n`);
  }
  if (state.player) {
    md.appendMarkdown(`Player: \`${state.player}\` (${labelForStatus(state.status)})`);
  }
  return md;
}

function tooltipKey(state: NowPlaying): string {
  return [
    state.title ?? "",
    state.artist ?? "",
    state.album ?? "",
    state.art_url ?? "",
    state.duration_ms ?? "",
    state.player ?? "",
    state.status,
  ].join("");
}

function escape(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|]/g, (c) => `\\${c}`);
}

function labelForStatus(s: Status): string {
  switch (s) {
    case "playing": return "playing";
    case "paused": return "paused";
    case "stopped": return "stopped";
    default: return "idle";
  }
}
