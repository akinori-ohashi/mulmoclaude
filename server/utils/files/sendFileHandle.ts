// Serve an already-opened file. `express.static` re-opens by path after the caller's check, so a
// path swapped in between is followed; serving from the verified handle closes that window.

import path from "node:path";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";

const HEX = 16;
const RANGE_NOT_SATISFIABLE = -1;

export interface ByteRange {
  start: number;
  end: number;
}

/** What `req.range(size, { combine: true })` returns: ranges, -1 (unsatisfiable), -2 (malformed) or nothing. */
export type ParsedRange = number | readonly ByteRange[] | undefined;

export type RangeChoice = { kind: "whole" } | { kind: "unsatisfiable" } | { kind: "part"; range: ByteRange };

const WHOLE: RangeChoice = { kind: "whole" };

/** Several ranges, a malformed header or none at all get the whole file, as `send` does. */
export function chooseByteRange(parsed: ParsedRange): RangeChoice {
  if (parsed === RANGE_NOT_SATISFIABLE) return { kind: "unsatisfiable" };
  const only = typeof parsed === "object" && parsed.length === 1 ? parsed[0] : undefined;
  return only === undefined ? WHOLE : { kind: "part", range: only };
}

const weakEtag = (stats: Stats): string => `W/"${stats.size.toString(HEX)}-${Math.floor(stats.mtimeMs).toString(HEX)}"`;

/** A Range is honoured only when there is no If-Range, or it names the representation being served. */
export function rangeApplies(ifRange: string | undefined, etag: string, lastModified: string): boolean {
  return ifRange === undefined || ifRange === etag || ifRange === lastModified;
}

function setEntityHeaders(res: Response, stats: Stats, relPath: string): void {
  if (res.getHeader("Content-Type") === undefined) res.type(path.extname(relPath) || "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=0");
  res.setHeader("Last-Modified", stats.mtime.toUTCString());
  res.setHeader("ETag", weakEtag(stats));
}

function requestedRange(req: Request, res: Response, size: number): RangeChoice {
  if (!rangeApplies(req.get("If-Range"), String(res.getHeader("ETag")), String(res.getHeader("Last-Modified")))) return WHOLE;
  return chooseByteRange(req.range(size, { combine: true }));
}

async function streamBytes(req: Request, res: Response, handle: FileHandle, size: number, choice: RangeChoice): Promise<void> {
  const { start, end } = choice.kind === "part" ? choice.range : { start: 0, end: size - 1 };
  if (choice.kind === "part") res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  res.setHeader("Content-Length", String(end - start + 1));
  if (req.method === "HEAD" || size === 0) {
    res.end();
    return;
  }
  // A client that goes away mid-body rejects the pipeline; the response is already torn down then.
  await pipeline(handle.createReadStream({ start, end, autoClose: false }), res).catch(() => res.destroy());
}

/** Serves `handle` as `relPath` (its extension picks the Content-Type unless one is set) and closes it. */
export async function sendFileHandle(req: Request, res: Response, handle: FileHandle, relPath: string): Promise<void> {
  try {
    const stats = await handle.stat();
    setEntityHeaders(res, stats, relPath);
    if (req.fresh) {
      res.status(304).end();
      return;
    }
    const choice = requestedRange(req, res, stats.size);
    if (choice.kind === "unsatisfiable") {
      res.status(416).setHeader("Content-Range", `bytes */${stats.size}`);
      res.end();
      return;
    }
    await streamBytes(req, res, handle, stats.size, choice);
  } finally {
    await handle.close();
  }
}
