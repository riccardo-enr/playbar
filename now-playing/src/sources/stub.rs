/*
 * Stub source for non-Linux targets. Always reports `Status::None`.
 * macOS and Windows backends will replace this in future iterations.
 */

use crate::state::{Command, NowPlaying};
use crate::sources::Source;
use async_trait::async_trait;
use tokio::sync::mpsc;

pub struct StubSource;

impl StubSource {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Source for StubSource {
    async fn snapshot(&mut self) -> anyhow::Result<NowPlaying> {
        Ok(NowPlaying::empty())
    }

    async fn control(&mut self, _cmd: Command) -> anyhow::Result<()> {
        Ok(())
    }

    fn take_events(&mut self) -> Option<mpsc::Receiver<NowPlaying>> {
        None
    }
}
