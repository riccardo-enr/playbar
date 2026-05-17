/*
 * Format-string interpolation and truncation.
 *
 * Placeholders: {playerIcon}, {artist}, {title}, {album},
 * {position}, {length}, {player}, {status}. Missing fields render as empty
 * strings; the result is then collapsed to single spaces and trimmed so a
 * missing artist doesn't leave a dangling " - " in the status bar.
 *
 * {playerIcon} resolves via a merged map (built-in defaults + user overrides)
 * keyed on the MPRIS bus suffix. {position} and {length} render `mm:ss` for
 * tracks under one hour and `h:mm:ss` otherwise.
 */

import { NowPlaying } from "./types";

const DEFAULT_PLAYER_ICONS: Record<string, string> = {
  spotify: "$(music)",
  firefox: "$(globe)",
  vlc: "$(device-camera-video)",
  mpv: "$(play-circle)",
  chromium: "$(globe)",
  "google-chrome": "$(globe)",
  brave: "$(globe)",
  audacious: "$(music)",
  rhythmbox: "$(music)",
};

export interface FormatExtras {
  playerIcons?: Record<string, string>;
}

export function format(
  state: NowPlaying,
  template: string,
  maxLength: number,
  extras: FormatExtras = {},
): string {
  const fields: Record<string, string> = {
    playerIcon: playerIconFor(state.player, extras.playerIcons ?? {}),
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

function playerIconFor(
  player: string | undefined,
  overrides: Record<string, string>,
): string {
  if (!player) {
    return "";
  }
  const merged = { ...DEFAULT_PLAYER_ICONS, ...overrides };
  if (merged[player]) {
    return merged[player];
  }
  const base = player.split(".", 1)[0];
  return merged[base] ?? "";
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
