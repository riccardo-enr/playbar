# Contributing

Thanks for your interest in improving PlayBar. This project has two
components — a Rust MPRIS sidecar (`now-playing/`) and a TypeScript VSCode
extension (`extension/`) — and contributions to either are welcome.

## Scope

Only Linux (x86_64) is supported. MPRIS is a Linux/D-Bus protocol, so PRs
adding macOS or Windows support are out of scope unless they introduce a
separate platform backend behind the same NDJSON interface.

## Getting set up

```bash
git clone https://github.com/riccardo-enr/vscode-now-playing
cd vscode-now-playing

# Sidecar
cd now-playing
cargo build

# Extension
cd ../extension
npm install
npm run compile
```

To run the extension against a debug sidecar, open `extension/` in VSCode,
press F5, and set `nowPlaying.sidecarPath` to your `target/debug/now-playing`
binary.

## Workflow

1. Open an issue first for anything beyond a small fix, so the approach can
   be discussed before code is written.
2. Branch from `main` using `feat/...`, `fix/...`, `chore/...`, or
   `docs/...`. Include the issue number when applicable
   (e.g. `feat/42-album-art`).
3. Keep changes focused. Prefer several small commits over one large one.
4. Reference the issue in commits and the PR description
   (`fixes #42`, `refs #42`).

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope][!]: <description>

[optional body]
[optional footer]
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.

## Code style

- **Rust**: `cargo fmt` and `cargo clippy --all-targets` must pass.
- **TypeScript**: `npm run compile` must pass without errors. Match the
  existing style in `extension/src/`.
- No Unicode in source or output; use ASCII equivalents (`->` not `→`,
  `+/-` not `±`).

## Testing

- Sidecar: `cargo test` from `now-playing/`.
- Extension: exercise the Extension Development Host (F5) against a real
  MPRIS player (Spotify, mpv, Firefox) and verify the status bar updates
  for play, pause, stop, and player switching.

If you change the NDJSON protocol between sidecar and extension, update
both sides and the docs under `docs/` in the same PR.

## Pull requests

- Target `main`.
- Describe the user-visible change and how you tested it.
- Update `README.md` and `docs/` when configuration, tokens, or behavior
  change.
- Delete the feature branch after merge.

## Reporting bugs

Open a GitHub issue with:

- Your Linux distribution and desktop environment.
- The MPRIS player and its version.
- Sidecar output from `now-playing --once` (and the event stream if the bug
  is timing-related).
- VSCode version and the relevant `nowPlaying.*` settings.
