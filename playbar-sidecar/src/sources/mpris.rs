/*
 * Linux MPRIS source backed by `zbus`.
 *
 * Player discovery walks `org.mpris.MediaPlayer2.*` bus names and picks
 * one according to the user's preference (suffix match) with the first
 * available as fallback. State is computed by reading the standard
 * MPRIS Player properties (`PlaybackStatus`, `Metadata`, `Position`).
 *
 * A background task subscribes to `NameOwnerChanged` (player lifecycle)
 * and `PropertiesChanged` (state changes) and pushes a refreshed
 * `NowPlaying` snapshot through the events channel whenever something
 * changes. Identical consecutive snapshots are filtered.
 */

use crate::state::{Command, Message, NowPlaying, PlayerEntry, PlayersEvent, Status};
use crate::sources::Source;
use async_trait::async_trait;
use futures_util::StreamExt;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};
use tokio::time::{interval, MissedTickBehavior};
use zbus::{
    fdo,
    names::BusName,
    zvariant::{OwnedValue, Value},
    Connection, Proxy,
};

const MPRIS_PREFIX: &str = "org.mpris.MediaPlayer2.";
const MPRIS_PATH: &str = "/org/mpris/MediaPlayer2";
const MPRIS_PLAYER_IFACE: &str = "org.mpris.MediaPlayer2.Player";
const MPRIS_ROOT_IFACE: &str = "org.mpris.MediaPlayer2";

pub struct MprisSource {
    conn: Connection,
    preferred: Arc<Mutex<Option<String>>>,
    last_now_playing: Arc<Mutex<NowPlaying>>,
    last_players: Arc<Mutex<PlayersEvent>>,
    events_rx: Option<mpsc::Receiver<Message>>,
    events_tx: mpsc::Sender<Message>,
}

impl MprisSource {
    pub async fn connect(preferred: Option<String>) -> anyhow::Result<Self> {
        let conn = Connection::session().await?;
        let (events_tx, events_rx) = mpsc::channel(16);
        let me = Self {
            conn,
            preferred: Arc::new(Mutex::new(preferred)),
            last_now_playing: Arc::new(Mutex::new(NowPlaying::empty())),
            last_players: Arc::new(Mutex::new(PlayersEvent {
                active: None,
                players: Vec::new(),
            })),
            events_rx: Some(events_rx),
            events_tx,
        };
        me.spawn_listener().await?;
        Ok(me)
    }

    async fn pick_active(&self) -> anyhow::Result<Option<String>> {
        pick_active(&self.conn, &*self.preferred.lock().await).await
    }

    async fn read_state(&self) -> anyhow::Result<NowPlaying> {
        let Some(bus) = self.pick_active().await? else {
            return Ok(NowPlaying::empty());
        };
        read_player_state(&self.conn, &bus).await
    }

    async fn refresh_and_emit(&self) {
        refresh_and_emit(
            &self.conn,
            &self.preferred,
            &self.last_now_playing,
            &self.last_players,
            &self.events_tx,
        )
        .await;
    }

    /*
     * Spawn the background listener.
     *
     * Two streams are merged: D-Bus `NameOwnerChanged` (tracks players
     * appearing / disappearing) and a `BecomeMonitor`-free
     * `PropertiesChanged` subscription on the standard MPRIS path
     * (matches signals from any player).
     */
    async fn spawn_listener(&self) -> anyhow::Result<()> {
        let conn = self.conn.clone();
        let preferred = self.preferred.clone();
        let last_np = self.last_now_playing.clone();
        let last_players = self.last_players.clone();
        let tx = self.events_tx.clone();

        let dbus = fdo::DBusProxy::new(&conn).await?;
        let mut name_owner_changed = dbus.receive_name_owner_changed().await?;

        // Match-rule subscription for PropertiesChanged on the standard
        // MPRIS path. Listening at the connection level avoids having
        // to attach/detach proxies as players come and go.
        let props_proxy = Proxy::new(
            &conn,
            "org.freedesktop.DBus",
            MPRIS_PATH,
            "org.freedesktop.DBus.Properties",
        )
        .await?;
        let mut props_changed = props_proxy.receive_signal("PropertiesChanged").await?;

        tokio::spawn(async move {
            // Emit an initial snapshot so consumers see something even
            // if no events ever fire.
            refresh_and_emit(&conn, &preferred, &last_np, &last_players, &tx).await;

            let mut tick = interval(Duration::from_secs(1));
            tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

            loop {
                tokio::select! {
                    Some(_) = name_owner_changed.next() => {
                        refresh_and_emit(&conn, &preferred, &last_np, &last_players, &tx).await;
                    }
                    Some(_) = props_changed.next() => {
                        refresh_and_emit(&conn, &preferred, &last_np, &last_players, &tx).await;
                    }
                    _ = tick.tick() => {
                        let playing = matches!(last_np.lock().await.status, Status::Playing);
                        if playing {
                            refresh_and_emit(&conn, &preferred, &last_np, &last_players, &tx).await;
                        }
                    }
                    else => break,
                }
            }
        });
        Ok(())
    }
}

#[async_trait]
impl Source for MprisSource {
    async fn snapshot(&mut self) -> anyhow::Result<NowPlaying> {
        self.read_state().await
    }

    async fn control(&mut self, cmd: Command) -> anyhow::Result<()> {
        if let Command::SelectPlayer { name } = &cmd {
            *self.preferred.lock().await = name.clone();
            // Re-emit so the consumer sees the switch immediately.
            self.refresh_and_emit().await;
            return Ok(());
        }
        if let Command::Refresh = cmd {
            self.refresh_and_emit().await;
            return Ok(());
        }

        let Some(bus) = self.pick_active().await? else {
            return Ok(());
        };
        if let Command::Raise = cmd {
            let proxy = Proxy::new(&self.conn, bus.as_str(), MPRIS_PATH, MPRIS_ROOT_IFACE).await?;
            proxy.call_method("Raise", &()).await?;
            return Ok(());
        }
        let method = match cmd {
            Command::PlayPause => "PlayPause",
            Command::Play => "Play",
            Command::Pause => "Pause",
            Command::Next => "Next",
            Command::Prev => "Previous",
            Command::Raise | Command::SelectPlayer { .. } | Command::Refresh => unreachable!(),
        };
        let proxy = Proxy::new(&self.conn, bus.as_str(), MPRIS_PATH, MPRIS_PLAYER_IFACE).await?;
        proxy.call_method(method, &()).await?;
        Ok(())
    }

    fn take_events(&mut self) -> Option<mpsc::Receiver<Message>> {
        self.events_rx.take()
    }
}

/*
 * Recompute both the active-player NowPlaying and the full players list,
 * then emit any message whose content changed since the last emission.
 *
 * The two states are tracked independently so a per-player metadata change
 * triggers a `players` event without re-emitting an unchanged NowPlaying.
 */
async fn refresh_and_emit(
    conn: &Connection,
    preferred: &Mutex<Option<String>>,
    last_np: &Mutex<NowPlaying>,
    last_players: &Mutex<PlayersEvent>,
    tx: &mpsc::Sender<Message>,
) {
    let pref = preferred.lock().await.clone();

    let buses: Vec<String> = list_player_buses(conn).await.unwrap_or_default();

    let active_bus = pick_active_from(&buses, &pref);
    let active_suffix = active_bus
        .as_ref()
        .map(|b| b.strip_prefix(MPRIS_PREFIX).unwrap_or(b).to_string());

    let np = match &active_bus {
        Some(bus) => read_player_state(conn, bus)
            .await
            .unwrap_or_else(|_| NowPlaying::empty()),
        None => NowPlaying::empty(),
    };

    let mut entries: Vec<PlayerEntry> = Vec::with_capacity(buses.len());
    for bus in &buses {
        let entry = match read_player_summary(conn, bus).await {
            Ok(e) => e,
            Err(_) => PlayerEntry {
                id: bus.strip_prefix(MPRIS_PREFIX).unwrap_or(bus).to_string(),
                status: Status::None,
                artist: None,
                title: None,
            },
        };
        entries.push(entry);
    }
    let players = PlayersEvent {
        active: active_suffix,
        players: entries,
    };

    {
        let mut guard = last_np.lock().await;
        if *guard != np {
            *guard = np.clone();
            let _ = tx.send(Message::NowPlaying(np)).await;
        }
    }
    {
        let mut guard = last_players.lock().await;
        if *guard != players {
            *guard = players.clone();
            let _ = tx.send(Message::Players(players)).await;
        }
    }
}

async fn list_player_buses(conn: &Connection) -> anyhow::Result<Vec<String>> {
    let dbus = fdo::DBusProxy::new(conn).await?;
    let names = dbus.list_names().await?;
    let mut players: Vec<String> = names
        .into_iter()
        .filter_map(|n| {
            let s: &str = n.as_str();
            if s.starts_with(MPRIS_PREFIX) {
                Some(s.to_string())
            } else {
                None
            }
        })
        .collect();
    players.sort();
    Ok(players)
}

fn pick_active_from(buses: &[String], preferred: &Option<String>) -> Option<String> {
    if let Some(pref) = preferred {
        let target = format!("{MPRIS_PREFIX}{pref}");
        if let Some(found) = buses
            .iter()
            .find(|n| **n == target || n.starts_with(&format!("{target}.")))
        {
            return Some(found.clone());
        }
    }
    buses.first().cloned()
}

async fn read_player_summary(conn: &Connection, bus: &str) -> anyhow::Result<PlayerEntry> {
    let bus_name = BusName::try_from(bus.to_string())?;
    let proxy = Proxy::new(conn, bus_name, MPRIS_PATH, MPRIS_PLAYER_IFACE).await?;
    let status: String = proxy
        .get_property("PlaybackStatus")
        .await
        .unwrap_or_else(|_| "Stopped".to_string());
    let metadata: HashMap<String, OwnedValue> = proxy
        .get_property("Metadata")
        .await
        .unwrap_or_default();
    let title = string_field(&metadata, "xesam:title");
    let artist = string_array_field(&metadata, "xesam:artist").map(|v| v.join(", "));
    Ok(PlayerEntry {
        id: bus.strip_prefix(MPRIS_PREFIX).unwrap_or(bus).to_string(),
        status: parse_status(&status),
        artist,
        title,
    })
}

/*
 * Pick the active player bus name.
 *
 * Strategy: list every `org.mpris.MediaPlayer2.*` name; if a preferred
 * suffix is set and matches one of them, use it; otherwise return the
 * first available. Returns `None` when no MPRIS player is on the bus.
 */
async fn pick_active(
    conn: &Connection,
    preferred: &Option<String>,
) -> anyhow::Result<Option<String>> {
    let buses = list_player_buses(conn).await?;
    Ok(pick_active_from(&buses, preferred))
}

async fn read_player_state(conn: &Connection, bus: &str) -> anyhow::Result<NowPlaying> {
    let bus_name = BusName::try_from(bus.to_string())?;
    let proxy = Proxy::new(conn, bus_name, MPRIS_PATH, MPRIS_PLAYER_IFACE).await?;

    let status: String = proxy
        .get_property("PlaybackStatus")
        .await
        .unwrap_or_else(|_| "Stopped".to_string());

    let metadata: HashMap<String, OwnedValue> = proxy
        .get_property("Metadata")
        .await
        .unwrap_or_default();

    let position_us: i64 = proxy.get_property("Position").await.unwrap_or(0);

    let suffix = bus.strip_prefix(MPRIS_PREFIX).unwrap_or(bus).to_string();

    let title = string_field(&metadata, "xesam:title");
    let album = string_field(&metadata, "xesam:album");
    let artist = string_array_field(&metadata, "xesam:artist").map(|v| v.join(", "));
    let art_url = string_field(&metadata, "mpris:artUrl");
    let duration_us: Option<i64> = i64_field(&metadata, "mpris:length");
    let year = string_field(&metadata, "xesam:contentCreated").and_then(parse_year);

    Ok(NowPlaying {
        player: Some(suffix),
        status: parse_status(&status),
        artist,
        title,
        album,
        art_url,
        year,
        position_ms: Some((position_us.max(0) as u64) / 1000),
        duration_ms: duration_us.map(|d| (d.max(0) as u64) / 1000),
    })
}

/*
 * Parse a `xesam:contentCreated` value (ISO 8601 like "2003-04-15T00:00:00Z",
 * or sometimes just a 4-digit year) into a calendar year.
 */
fn parse_year(s: String) -> Option<u16> {
    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.len() < 4 {
        return None;
    }
    digits[..4].parse().ok()
}

fn parse_status(s: &str) -> Status {
    match s {
        "Playing" => Status::Playing,
        "Paused" => Status::Paused,
        "Stopped" => Status::Stopped,
        _ => Status::None,
    }
}

fn string_field(meta: &HashMap<String, OwnedValue>, key: &str) -> Option<String> {
    match &**meta.get(key)? {
        Value::Str(s) => Some(s.to_string()),
        _ => None,
    }
}

fn string_array_field(meta: &HashMap<String, OwnedValue>, key: &str) -> Option<Vec<String>> {
    let Value::Array(arr) = &**meta.get(key)? else {
        return None;
    };
    let mut out = Vec::with_capacity(arr.len());
    for item in arr.iter() {
        if let Value::Str(s) = item {
            out.push(s.to_string());
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn i64_field(meta: &HashMap<String, OwnedValue>, key: &str) -> Option<i64> {
    match &**meta.get(key)? {
        Value::I64(n) => Some(*n),
        Value::U64(n) => Some(*n as i64),
        Value::I32(n) => Some(*n as i64),
        Value::U32(n) => Some(*n as i64),
        _ => None,
    }
}
