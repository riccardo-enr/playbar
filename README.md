# Now Playing

VSCode status-bar extension that mirrors `tmux-powerline`'s music segment.
A small Rust sidecar (`now-playing/`) talks to MPRIS over D-Bus and emits
NDJSON; a thin TypeScript extension (`extension/`) renders the result.

Full documentation: <https://riccardo-enr.github.io/vscode-now-playing/>
(source under [`docs/`](docs/)).

> **Note**: only tested on Linux (x86_64). MPRIS is a Linux/D-Bus protocol,
> so macOS and Windows are not supported.

## Install

Grab the latest `now-playing-linux-x64-*.vsix` from the
[Releases page](https://github.com/riccardo-enr/vscode-now-playing/releases)
and install it:

```bash
code --install-extension now-playing-linux-x64-X.Y.Z.vsix
```

The sidecar binary is bundled inside the VSIX, so no separate build step is
required. To point at a checked-out debug binary instead, set
`nowPlaying.sidecarPath` in your VSCode settings.

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

## Configuration

`nowPlaying.format` accepts a template string with the following placeholders:

| Token        | Renders                                                          |
|--------------|------------------------------------------------------------------|
| `{icon}`     | Codicon driven by playback status (play/pause/stop, empty if none) |
| `{playerIcon}` | Codicon for the active MPRIS player (see "Player icons" below) |
| `{artist}`   | Track artist                                                     |
| `{title}`    | Track title                                                      |
| `{album}`    | Album name                                                       |
| `{position}` | Current playback position, `mm:ss` (or `h:mm:ss` over one hour)  |
| `{length}`   | Track duration, same format as `{position}`                      |
| `{player}`   | MPRIS player identifier (e.g. `spotify`)                         |
| `{status}`   | Raw status string (`playing` / `paused` / `stopped` / `none`)    |

Missing fields render as empty and adjacent ` - ` separators collapse, so a
format like `"{icon} {artist} - {title} [{position}/{length}]"` degrades
gracefully when a player does not expose position or album metadata.

### Player icons

`{playerIcon}` resolves via a merged map (built-in defaults + the user
setting `nowPlaying.playerIcons`). Keys are the MPRIS bus suffix
(`state.player`); values are codicon strings.

Built-in defaults:

| Player      | Codicon                |
|-------------|------------------------|
| `spotify`   | `$(music)`             |
| `firefox`   | `$(globe)`             |
| `vlc`       | `$(device-camera-video)` |
| `mpv`       | `$(play-circle)`       |
| `chromium`  | `$(globe)`             |
| `google-chrome` | `$(globe)`         |
| `brave`     | `$(globe)`             |
| `audacious` | `$(music)`             |
| `rhythmbox` | `$(music)`             |

Some players (Firefox, Chromium) expose suffixes like
`firefox.instance_1_84`. Lookup falls back to the prefix before the first
dot, so `firefox.*` resolves via the `firefox` entry. To override or add
entries:

```json
"nowPlaying.playerIcons": {
  "spotify": "$(megaphone)",
  "amberol": "$(music)"
}
```

### Auto-hide

Two grace-period settings keep the status bar tidy when nothing is actively
playing. Both default to `0` (disabled).

- `nowPlaying.hidePausedAfterSeconds` — hide once the player has been paused
  for that many seconds. The bar reappears as soon as playback resumes.
- `nowPlaying.hideIdleAfterSeconds` — same idea when the player is stopped.

## Standalone use

The sidecar is useful by itself:

```bash
now-playing --once                       # one JSON snapshot, then exit
now-playing                              # event stream on stdout
echo next | now-playing                  # control via stdin (also accepts JSON)
now-playing --player spotify             # restrict to a specific player
```
