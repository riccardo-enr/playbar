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
  year?: number;
  position_ms?: number;
  duration_ms?: number;
}

export interface PlayerEntry {
  id: string;
  status: Status;
  artist?: string;
  title?: string;
}

export interface PlayersEvent {
  active?: string;
  players: PlayerEntry[];
}

export type Message =
  | ({ kind: "now_playing" } & NowPlaying)
  | ({ kind: "players" } & PlayersEvent);

export type Command =
  | { cmd: "play" }
  | { cmd: "pause" }
  | { cmd: "next" }
  | { cmd: "prev" }
  | { cmd: "raise" }
  | { cmd: "refresh" }
  | { cmd: "select_player"; name: string | null };
