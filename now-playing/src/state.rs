/*
 * Wire types for the sidecar IPC.
 *
 * `NowPlaying` is the public state shape emitted on stdout. `Command` is
 * the input shape consumed from stdin. Both serialize as compact JSON,
 * one record per line (NDJSON).
 */

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Playing,
    Paused,
    Stopped,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NowPlaying {
    /// Bus suffix of the active player (e.g. "spotify"). None when no
    /// player is available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player: Option<String>,
    pub status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub art_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

impl NowPlaying {
    pub fn empty() -> Self {
        Self {
            player: None,
            status: Status::None,
            artist: None,
            title: None,
            album: None,
            art_url: None,
            position_ms: None,
            duration_ms: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Command {
    PlayPause,
    Play,
    Pause,
    Next,
    Prev,
    Raise,
    SelectPlayer { name: Option<String> },
    Refresh,
}
