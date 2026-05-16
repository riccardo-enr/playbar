/*
 * Format-string interpolation and truncation.
 *
 * Placeholders: {artist}, {title}, {album}, {player}, {status}.
 * Missing fields render as empty strings; the result is then collapsed
 * to single spaces and trimmed so a missing artist doesn't leave a
 * dangling " - " in the status bar.
 */

import { NowPlaying } from "./types";

export function format(state: NowPlaying, template: string, maxLength: number): string {
  const fields: Record<string, string> = {
    artist: state.artist ?? "",
    title: state.title ?? "",
    album: state.album ?? "",
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
