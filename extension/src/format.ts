/*
 * Format-string interpolation and truncation.
 *
 * Placeholders: {icon}, {artist}, {title}, {album}, {position}, {length},
 * {player}, {status}. Missing fields render as empty strings; the result is
 * then collapsed to single spaces and trimmed so a missing artist doesn't
 * leave a dangling " - " in the status bar.
 *
 * {icon} resolves to a codicon driven by playback status. {position} and
 * {length} render `mm:ss` for tracks under one hour and `h:mm:ss` otherwise.
 */

import { NowPlaying, Status } from "./types";

export function format(state: NowPlaying, template: string, maxLength: number): string {
  const fields: Record<string, string> = {
    icon: iconFor(state.status),
    artist: state.artist ?? "",
    title: state.title ?? "",
    album: state.album ?? "",
    position: formatTime(state.position_ms),
    length: formatTime(state.duration_ms),
    player: state.player ?? "",
    status: state.status,
  };
  let out = template.replace(/\{(\w+)\}/g, (_, k) => fields[k] ?? "");
  out = out.replace(/\s*-\s*-\s*/g, " - ");
  out = out.replace(/\s{2,}/g, " ").trim();
  out = out.replace(/-\s*$/, "").replace(/^\s*-/, "").trim();
  if (maxLength > 0 && out.length > maxLength) {
    out = out.slice(0, Math.max(1, maxLength - 1)) + "…";
  }
  return out;
}

function iconFor(status: Status): string {
  switch (status) {
    case "playing": return "$(play)";
    case "paused": return "$(debug-pause)";
    case "stopped": return "$(primitive-square)";
    default: return "";
  }
}

function formatTime(ms: number | undefined): string {
  if (ms === undefined || ms < 0) {
    return "";
  }
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
