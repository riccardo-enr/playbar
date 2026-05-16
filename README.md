# Now Playing

VSCode status-bar extension that mirrors `tmux-powerline`'s music segment.
A small Rust sidecar (`now-playing/`) talks to MPRIS over D-Bus and emits
NDJSON; a thin TypeScript extension (`extension/`) renders the result.

Full documentation: <https://riccardo-enr.github.io/vscode-now-playing/>
(source under [`docs/`](docs/)).

## Layout

```
now-playing/   Rust sidecar (the OS-facing binary)
extension/     VSCode extension shim (TypeScript)
```

## Build

```bash
# Sidecar
cd now-playing
cargo build --release

# Extension
cd ../extension
npm install
npm run compile

# Place the sidecar where the extension expects it (Linux x86_64):
mkdir -p bin/linux-x64
cp ../now-playing/target/release/now-playing bin/linux-x64/
```

To run the extension, open `extension/` in VSCode and press F5 (Extension
Development Host). Override `nowPlaying.sidecarPath` in settings if you'd
rather point at a checked-out debug binary.

## Standalone use

The sidecar is useful by itself:

```bash
now-playing --once                       # one JSON snapshot, then exit
now-playing                              # event stream on stdout
echo next | now-playing                  # control via stdin (also accepts JSON)
now-playing --player spotify             # restrict to a specific player
```
