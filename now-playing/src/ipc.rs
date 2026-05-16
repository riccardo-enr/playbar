/*
 * NDJSON stdio loop.
 *
 * Concurrently:
 *   - drains the source's event stream and writes one JSON line per
 *     state change to stdout (with a trailing newline, flushed);
 *   - reads commands one line at a time from stdin and dispatches them
 *     to the source. Malformed lines are reported on stderr and
 *     skipped.
 *
 * The loop ends when stdin reaches EOF, the source's event channel
 * closes, or SIGINT/SIGTERM arrives.
 */

use crate::sources::Source;
use crate::state::Command;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub async fn run(source: &mut dyn Source) -> anyhow::Result<()> {
    let mut events = source
        .take_events()
        .ok_or_else(|| anyhow::anyhow!("source has no event stream"))?;

    let stdin = tokio::io::stdin();
    let mut stdin_lines = BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();

    let sigint = tokio::signal::ctrl_c();
    tokio::pin!(sigint);

    loop {
        tokio::select! {
            biased;
            _ = &mut sigint => break,
            evt = events.recv() => {
                match evt {
                    Some(state) => {
                        let mut line = serde_json::to_vec(&state)?;
                        line.push(b'\n');
                        stdout.write_all(&line).await?;
                        stdout.flush().await?;
                    }
                    None => break,
                }
            }
            line = stdin_lines.next_line() => {
                match line? {
                    Some(line) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        match parse_command(trimmed) {
                            Ok(cmd) => {
                                if let Err(e) = source.control(cmd).await {
                                    eprintln!("control error: {e}");
                                }
                            }
                            Err(e) => eprintln!("bad command {trimmed:?}: {e}"),
                        }
                    }
                    None => break,
                }
            }
        }
    }
    Ok(())
}

/*
 * Accept either full JSON (`{"cmd":"next"}`) or a bare command word
 * (`next`). The bare form is convenient for ad-hoc shell use.
 */
fn parse_command(s: &str) -> Result<Command, serde_json::Error> {
    if s.starts_with('{') {
        serde_json::from_str(s)
    } else {
        let wrapped = format!("{{\"cmd\":\"{s}\"}}");
        serde_json::from_str(&wrapped)
    }
}
