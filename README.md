<p align="left">
  <img src="extension/assets/icon.png" alt="PlayBar icon" width="96" height="96">
</p>

# PlayBar

VSCode status-bar extension that mirrors `tmux-powerline`'s music segment.
A small Rust sidecar (`playbar-sidecar/`) talks to MPRIS over D-Bus and emits
NDJSON; a thin TypeScript extension (`extension/`) renders the result.

Full documentation: <https://riccardo-enr.github.io/playbar/>
(source under [`docs/`](docs/)).

> **Note**: only tested on Linux (x86_64). MPRIS is a Linux/D-Bus protocol,
> so macOS and Windows are not supported.

## Install

Grab the latest `.vsix` from the
[Releases page](https://github.com/riccardo-enr/playbar/releases)
and install it:

```bash
code --install-extension playbar-X.Y.Z.vsix
```

The sidecar binary is bundled inside the VSIX, so no separate build step is
required. To point at a checked-out debug binary instead, set
`playbar.sidecarPath` in your VSCode settings.

## Layout

```
playbar-sidecar/   Rust sidecar (the OS-facing binary)
extension/     VSCode extension shim (TypeScript)
```

## Build

```bash
# Sidecar
cd playbar-sidecar
cargo build --release

# Extension
cd ../extension
npm install
npm run compile

# Place the sidecar where the extension expects it (Linux x86_64):
mkdir -p bin/linux-x64
cp ../playbar-sidecar/target/release/playbar bin/linux-x64/
```

To run the extension, open `extension/` in VSCode and press F5 (Extension
Development Host). Override `playbar.sidecarPath` in settings if you'd
rather point at a checked-out debug binary.

## Configuration

`playbar.format` accepts a template string with the following placeholders:

| Token        | Renders                                                          |
|--------------|------------------------------------------------------------------|
| `{playerIcon}` | Codicon for the active MPRIS player (see "Player icons" below) |
| `{artist}`   | Track artist                                                     |
| `{title}`    | Track title                                                      |
| `{album}`    | Album name                                                       |
| `{position}` | Current playback position, `mm:ss` (or `h:mm:ss` over one hour)  |
| `{length}`   | Track duration, same format as `{position}`                      |
| `{player}`   | MPRIS player identifier (e.g. `spotify`)                         |
| `{status}`   | Raw status string (`playing` / `paused` / `stopped` / `none`)    |

Missing fields render as empty and adjacent ` - ` separators collapse, so a
format like `"{playerIcon} {artist} - {title} [{position}/{length}]"` degrades
gracefully when a player does not expose position or album metadata.

### Player icons

`{playerIcon}` resolves via a merged map (built-in defaults + the user
setting `playbar.playerIcons`). Keys are the MPRIS bus suffix
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
"playbar.playerIcons": {
  "spotify": "$(megaphone)",
  "amberol": "$(music)"
}
```

### Auto-hide

Two grace-period settings keep the status bar tidy when nothing is actively
playing. Both default to `0` (disabled).

- `playbar.hidePausedAfterSeconds` — hide once the player has been paused
  for that many seconds. The bar reappears as soon as playback resumes.
- `playbar.hideIdleAfterSeconds` — same idea when the player is stopped.

### Marquee

When the rendered text is wider than `playbar.maxLength`, the default is
to truncate with an ellipsis. Set `playbar.marquee.enabled` to `true` to
scroll the text instead. Tune `marquee.speedMs`, `marquee.pauseEndsMs`, and
`marquee.gap` to taste — see the [configuration page](docs/configuration.qmd)
for defaults.

### Hover tooltip

Hovering the status bar item reveals cover art (when the player exposes it),
the track title, and the album with its release year in parentheses when
available.

## Standalone use

The sidecar is useful by itself:

```bash
playbar --once                       # one JSON snapshot, then exit
playbar                              # event stream on stdout
echo next | playbar                  # control via stdin (also accepts JSON)
playbar --player spotify             # restrict to a specific player
```
