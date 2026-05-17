/*
 * Resolves MPRIS `art_url` values to inline `data:` URIs so the status bar
 * tooltip can embed cover art without VSCode's webview having to load an
 * external resource (which silently fails for http(s) and most file: URLs,
 * leaving a broken-image placeholder).
 *
 * Strategy: small in-memory LRU keyed by source URL. `lookup` is synchronous
 * and returns the cached data URI or "miss" / "skip". On a miss the caller
 * kicks off `fetch` asynchronously and re-renders once it resolves.
 */

import { promises as fs } from "fs";
import { fileURLToPath } from "url";

const MAX_BYTES = 512 * 1024;
const MAX_ENTRIES = 16;

export type ArtResult =
  | { kind: "ready"; dataUrl: string }
  | { kind: "skip" } // unsupported scheme or known-bad URL; do not render <img>
  | { kind: "miss" }; // not fetched yet; caller should fetch

export class ArtCache {
  private readonly entries = new Map<string, ArtResult>();
  private readonly inflight = new Map<string, Promise<ArtResult>>();

  lookup(url: string): ArtResult {
    const key = url.trim();
    if (!key) return { kind: "skip" };
    const hit = this.entries.get(key);
    if (hit) {
      this.touch(key, hit);
      return hit;
    }
    return { kind: "miss" };
  }

  async fetch(url: string): Promise<ArtResult> {
    const key = url.trim();
    if (!key) return { kind: "skip" };
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const p = this.doFetch(key).then((res) => {
      this.touch(key, res);
      this.inflight.delete(key);
      return res;
    }).catch(() => {
      const res: ArtResult = { kind: "skip" };
      this.touch(key, res);
      this.inflight.delete(key);
      return res;
    });
    this.inflight.set(key, p);
    return p;
  }

  private touch(key: string, res: ArtResult) {
    this.entries.delete(key);
    this.entries.set(key, res);
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  private async doFetch(url: string): Promise<ArtResult> {
    if (/^data:image\//i.test(url)) {
      return { kind: "ready", dataUrl: url };
    }
    if (/^file:/i.test(url)) {
      const path = fileURLToPath(url);
      const buf = await fs.readFile(path);
      if (buf.byteLength > MAX_BYTES) return { kind: "skip" };
      const mime = guessMime(path, buf);
      if (!mime) return { kind: "skip" };
      return { kind: "ready", dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
    }
    if (/^https?:/i.test(url)) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5000);
      try {
        const resp = await fetch(url, { signal: ac.signal });
        if (!resp.ok) return { kind: "skip" };
        const ct = resp.headers.get("content-type") ?? "";
        const ab = await resp.arrayBuffer();
        if (ab.byteLength > MAX_BYTES) return { kind: "skip" };
        const buf = Buffer.from(ab);
        const mime = ct.startsWith("image/") ? ct.split(";")[0] : guessMime(url, buf);
        if (!mime) return { kind: "skip" };
        return { kind: "ready", dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
      } finally {
        clearTimeout(timer);
      }
    }
    return { kind: "skip" };
  }
}

function guessMime(pathOrUrl: string, buf: Buffer): string | undefined {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (buf.length >= 6) {
    const head = buf.toString("ascii", 0, 6);
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  const lower = pathOrUrl.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return undefined;
}
