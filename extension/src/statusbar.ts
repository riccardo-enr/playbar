/*
 * Status bar rendering. Holds the main "now playing" item plus
 * optional prev / play-pause / next control items. Items are hidden
 * when no media is available so they don't take space.
 */

import * as vscode from "vscode";

import { ArtCache } from "./artcache";
import { format, formatTime, FormatRule } from "./format";
import { NowPlaying, Status } from "./types";

export interface StatusBarOptions {
  alignment: "left" | "right";
  priority: number;
  template: string;
  maxLength: number;
  showControls: boolean;
  hidePausedAfterSeconds: number;
  hideIdleAfterSeconds: number;
  playerIcons: Record<string, string>;
  formatRules: FormatRule[];
  marqueeEnabled: boolean;
  marqueeSpeedMs: number;
  marqueePauseEndsMs: number;
  marqueeGap: string;
}

export class StatusBar implements vscode.Disposable {
  private readonly main: vscode.StatusBarItem;
  private readonly prev?: vscode.StatusBarItem;
  private readonly next?: vscode.StatusBarItem;
  private lastTooltipKey: string = "";
  private hideTimer: NodeJS.Timeout | undefined;
  private marqueeTimer: NodeJS.Timeout | undefined;
  private marqueeAtoms: string[] = [];
  private marqueeSource: string = "";
  private marqueeOffset = 0;
  private lastStatus: Status | undefined;
  private autoHidden = false;
  private lastState: NowPlaying | undefined;
  private readonly artCache = new ArtCache();

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

    this.lastState = state;
    const effectiveMax = this.opts.marqueeEnabled ? 0 : this.opts.maxLength;
    const fullText = format(state, this.opts.template, effectiveMax, {
      playerIcons: this.opts.playerIcons,
      rules: this.opts.formatRules,
    });
    this.applyText(fullText);
    const artDataUrl = this.resolveArt(state.art_url);
    const key = tooltipKey(state, artDataUrl);
    if (key !== this.lastTooltipKey) {
      this.main.tooltip = buildTooltip(state, artDataUrl);
      this.lastTooltipKey = key;
    }
    this.main.show();

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
    this.stopMarquee();
    this.main.hide();
    this.prev?.hide();
    this.next?.hide();
  }

  dispose() {
    this.clearHideTimer();
    this.stopMarquee();
    this.main.dispose();
    this.prev?.dispose();
    this.next?.dispose();
  }

  private applyText(fullText: string) {
    const max = this.opts.maxLength;
    if (!this.opts.marqueeEnabled || max <= 0) {
      this.stopMarquee();
      this.main.text = fullText;
      return;
    }
    const atoms = tokenizeAtoms(fullText);
    if (atoms.length <= max) {
      this.stopMarquee();
      this.main.text = fullText;
      return;
    }
    this.startMarquee(fullText, atoms);
  }

  private startMarquee(source: string, atoms: string[]) {
    if (this.marqueeSource === source && this.marqueeTimer) {
      return;
    }
    this.stopMarquee();
    this.marqueeSource = source;
    this.marqueeAtoms = atoms.concat(tokenizeAtoms(this.opts.marqueeGap));
    this.marqueeOffset = 0;
    const win = this.opts.maxLength;
    this.main.text = renderWindow(this.marqueeAtoms, 0, win);
    const tick = () => {
      this.marqueeOffset = (this.marqueeOffset + 1) % this.marqueeAtoms.length;
      this.main.text = renderWindow(this.marqueeAtoms, this.marqueeOffset, win);
      const delay = this.marqueeOffset === 0
        ? this.opts.marqueePauseEndsMs
        : this.opts.marqueeSpeedMs;
      this.marqueeTimer = setTimeout(tick, delay);
    };
    this.marqueeTimer = setTimeout(tick, this.opts.marqueePauseEndsMs);
  }

  private stopMarquee() {
    if (this.marqueeTimer) {
      clearTimeout(this.marqueeTimer);
      this.marqueeTimer = undefined;
    }
    this.marqueeSource = "";
    this.marqueeAtoms = [];
    this.marqueeOffset = 0;
  }

  private resolveArt(url: string | undefined): string | undefined {
    if (!url) return undefined;
    const res = this.artCache.lookup(url);
    if (res.kind === "ready") return res.dataUrl;
    if (res.kind === "skip") return undefined;
    // miss: fetch in background, then re-render so the tooltip picks it up
    void this.artCache.fetch(url).then(() => {
      if (this.lastState && this.lastState.art_url === url) {
        this.render(this.lastState);
      }
    });
    return undefined;
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

function buildTooltip(state: NowPlaying, artDataUrl: string | undefined): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = false;
  md.supportHtml = true;
  if (artDataUrl) {
    md.appendMarkdown(`<img src="${artDataUrl}" width="180" height="180" />\n\n`);
  }
  if (state.title) {
    md.appendMarkdown(`**${escape(state.title)}**\n\n`);
  }
  if (state.artist) {
    md.appendMarkdown(`${escape(state.artist)}\n\n`);
  }
  if (state.album) {
    const yearSuffix = state.year ? ` (${state.year})` : "";
    md.appendMarkdown(`_${escape(state.album)}${escape(yearSuffix)}_\n\n`);
  } else if (state.year) {
    md.appendMarkdown(`_(${state.year})_\n\n`);
  }
  const length = formatTime(state.duration_ms);
  if (length) {
    md.appendMarkdown(`Length: ${length}\n\n`);
  }
  if (state.player) {
    md.appendMarkdown(`Player: \`${state.player}\` (${labelForStatus(state.status)})`);
  }
  return md;
}

function tooltipKey(state: NowPlaying, artDataUrl: string | undefined): string {
  return [
    state.title ?? "",
    state.artist ?? "",
    state.album ?? "",
    state.art_url ?? "",
    state.year ?? "",
    state.duration_ms ?? "",
    state.player ?? "",
    state.status,
    artDataUrl ? "1" : "0",
  ].join("");
}

function escape(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|]/g, (c) => `\\${c}`);
}

/*
 * Split a status-bar string into "atoms" where each `$(codicon)` sequence
 * counts as a single atom. Sliding a window across atoms (instead of
 * characters) keeps codicons intact when the marquee scrolls.
 */
function tokenizeAtoms(s: string): string[] {
  const re = /\$\([^)]+\)|./gsu;
  const out: string[] = [];
  for (const m of s.matchAll(re)) {
    out.push(m[0]);
  }
  return out;
}

function renderWindow(atoms: string[], offset: number, width: number): string {
  const n = atoms.length;
  let out = "";
  for (let i = 0; i < width; i++) {
    out += atoms[(offset + i) % n];
  }
  return out;
}

function labelForStatus(s: Status): string {
  switch (s) {
    case "playing": return "playing";
    case "paused": return "paused";
    case "stopped": return "stopped";
    default: return "idle";
  }
}
