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
    pub year: Option<u16>,
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
            year: None,
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

/*
 * Per-player lightweight summary carried inside a `Players` event.
 *
 * `id` is the MPRIS bus-name suffix (e.g. "spotify", "firefox.instance_1_5").
 * Only minimal metadata is included so the payload stays small; full
 * metadata is still only emitted for the active player via `NowPlaying`.
 */
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerEntry {
    pub id: String,
    pub status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayersEvent {
    /// Suffix of the player currently treated as active, or None when no
    /// player is on the bus.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<String>,
    pub players: Vec<PlayerEntry>,
}

/*
 * Outbound NDJSON message envelope.
 *
 * Every line emitted on stdout carries a `kind` discriminator so the
 * extension can route on shape rather than sniffing fields. The variant
 * payload is flattened in alongside `kind`.
 */
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Message {
    NowPlaying(NowPlaying),
    Players(PlayersEvent),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_playing_message_round_trips_with_kind() {
        let msg = Message::NowPlaying(NowPlaying {
            player: Some("spotify".into()),
            status: Status::Playing,
            artist: Some("Daft Punk".into()),
            title: Some("One More Time".into()),
            album: None,
            art_url: None,
            year: None,
            position_ms: Some(1234),
            duration_ms: Some(60000),
        });
        let json = serde_json::to_string(&msg).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["kind"], "now_playing");
        assert_eq!(v["player"], "spotify");
        assert_eq!(v["status"], "playing");
        assert_eq!(v["title"], "One More Time");
        assert_eq!(v["position_ms"], 1234);
        // album/art_url/year omitted by skip_serializing_if
        assert!(v.get("album").is_none());

        let parsed: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, msg);
    }

    #[test]
    fn players_event_round_trips_with_kind() {
        let msg = Message::Players(PlayersEvent {
            active: Some("spotify".into()),
            players: vec![
                PlayerEntry {
                    id: "spotify".into(),
                    status: Status::Playing,
                    artist: Some("X".into()),
                    title: Some("Y".into()),
                },
                PlayerEntry {
                    id: "firefox.instance_1_5".into(),
                    status: Status::Paused,
                    artist: None,
                    title: None,
                },
            ],
        });
        let json = serde_json::to_string(&msg).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["kind"], "players");
        assert_eq!(v["active"], "spotify");
        assert_eq!(v["players"][0]["id"], "spotify");
        assert_eq!(v["players"][0]["status"], "playing");
        assert_eq!(v["players"][1]["id"], "firefox.instance_1_5");
        assert!(v["players"][1].get("artist").is_none());

        let parsed: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, msg);
    }

    #[test]
    fn players_event_empty_omits_active() {
        let msg = Message::Players(PlayersEvent {
            active: None,
            players: vec![],
        });
        let json = serde_json::to_string(&msg).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["kind"], "players");
        assert!(v.get("active").is_none());
        assert_eq!(v["players"].as_array().unwrap().len(), 0);
    }
}
