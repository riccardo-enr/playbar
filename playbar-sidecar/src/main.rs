/*
 * `playbar` sidecar entry point.
 *
 * Two run modes:
 *   - default: long-running. Subscribe to media-player events, emit one
 *     NDJSON line on stdout per state change, accept commands on stdin.
 *   - `--once`: print a single JSON snapshot to stdout and exit. Useful
 *     for shell / tmux-powerline reuse and for tests.
 */

mod ipc;
mod state;
mod sources;

use clap::Parser;

#[derive(Debug, Parser)]
#[command(name = "playbar", version, about)]
struct Cli {
    /// Print a single snapshot as JSON and exit.
    #[arg(long)]
    once: bool,

    /// Preferred player name (MPRIS bus suffix, e.g. "spotify"). When unset,
    /// the most-recently-active player wins.
    #[arg(long)]
    player: Option<String>,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let mut source = sources::default_source(cli.player.clone()).await?;

    if cli.once {
        let snapshot = source.snapshot().await?;
        println!("{}", serde_json::to_string(&snapshot)?);
        return Ok(());
    }

    ipc::run(&mut *source).await
}
