/*
 * Wire types mirroring the Rust sidecar's `state.rs`.
 */

export type Status = "playing" | "paused" | "stopped" | "none";

export interface NowPlaying {
  player?: string;
  status: Status;
  artist?: string;
  title?: string;
  album?: string;
  art_url?: string;
  position_ms?: number;
  duration_ms?: number;
}

export type Command =
  | { cmd: "play_pause" }
  | { cmd: "play" }
  | { cmd: "pause" }
  | { cmd: "next" }
  | { cmd: "prev" }
  | { cmd: "raise" }
  | { cmd: "refresh" }
  | { cmd: "select_player"; name: string | null };
