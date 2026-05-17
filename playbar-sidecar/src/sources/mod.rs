/*
 * Per-platform media source.
 *
 * Each backend implements `Source`: a snapshot accessor, a control entry
 * point, and an event stream. The IPC loop owns one boxed `Source` and
 * forwards user commands / state changes through it.
 *
 * Linux uses MPRIS via D-Bus (`zbus`). Other platforms compile to a
 * stub that always reports `Status::None`.
 */

use crate::state::{Command, Message, NowPlaying};
use async_trait::async_trait;
use tokio::sync::mpsc;

#[async_trait]
pub trait Source: Send {
    /// Read the current active-player state once.
    async fn snapshot(&mut self) -> anyhow::Result<NowPlaying>;

    /// Apply a control command. Selecting a player updates internal state
    /// only and does not block on a remote response.
    async fn control(&mut self, cmd: Command) -> anyhow::Result<()>;

    /// Take ownership of the event stream. Returns `None` if events are
    /// not yet available (e.g. `--once` mode never wires this up).
    fn take_events(&mut self) -> Option<mpsc::Receiver<Message>>;
}

#[cfg(target_os = "linux")]
pub mod mpris;

#[cfg(not(target_os = "linux"))]
pub mod stub;

pub async fn default_source(preferred: Option<String>) -> anyhow::Result<Box<dyn Source>> {
    #[cfg(target_os = "linux")]
    {
        Ok(Box::new(mpris::MprisSource::connect(preferred).await?))
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = preferred;
        Ok(Box::new(stub::StubSource::new()))
    }
}
