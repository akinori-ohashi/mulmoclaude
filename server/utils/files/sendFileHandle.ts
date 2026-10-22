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

/** The validators a conditional request is judged against, as headers carry them. */
export interface Validators {
  etag: string;
  lastModified: string;
}

const parseHttpDate = (value: string | undefined): number => (value === undefined ? Number.NaN : Date.parse(value));

const tokenList = (header: string): string[] =>
  header
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token !== "");

const etagMatches = (token: string, etag: string): boolean => token === etag || `W/${token}` === etag || token === `W/${etag}`;

/** A Range is honoured without If-Range, or when If-Range names the current entity tag or a date no older than it — as `send` does. */
export function rangeApplies(ifRange: string | undefined, validators: Validators): boolean {
  if (ifRange === undefined || ifRange === "") return true;
  if (ifRange.includes('"')) return ifRange.includes(validators.etag);
  return parseHttpDate(validators.lastModified) <= parseHttpDate(ifRange);
}

/** If-Match / If-Unmodified-Since that the current entity fails, answered 412 as `send` does. */
export function preconditionFailed(ifMatch: string | undefined, ifUnmodifiedSince: string | undefined, validators: Validators): boolean {
  if (ifMatch !== undefined && ifMatch !== "") return ifMatch !== "*" && !tokenList(ifMatch).some((token) => etagMatches(token, validators.etag));
  const unmodifiedSince = parseHttpDate(ifUnmodifiedSince);
  const lastModified = parseHttpDate(validators.lastModified);
  return !Number.isNaN(unmodifiedSince) && (Number.isNaN(lastModified) || lastModified > unmodifiedSince);
}

function setEntityHeaders(res: Response, stats: Stats, relPath: string): Validators {
  const validators = { etag: weakEtag(stats), lastModified: stats.mtime.toUTCString() };
  if (res.getHeader("Content-Type") === undefined) res.type(path.extname(relPath) || "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=0");
  res.setHeader("Last-Modified", validators.lastModified);
  res.setHeader("ETag", validators.etag);
  return validators;
}

function requestedRange(req: Request, size: number, validators: Validators): RangeChoice {
  if (!rangeApplies(req.get("If-Range"), validators)) return WHOLE;
  return chooseByteRange(req.range(size, { combine: true }));
}

/** 412 / 304 / 416 carry no body, like the 404s these mounts answer. True when one was sent. */
function answeredWithoutBody(req: Request, res: Response, size: number, validators: Validators, choice: RangeChoice): boolean {
  if (preconditionFailed(req.get("If-Match"), req.get("If-Unmodified-Since"), validators)) res.status(412);
  else if (req.fresh) res.status(304);
  else if (choice.kind === "unsatisfiable") res.status(416).setHeader("Content-Range", `bytes */${size}`);
  else return false;
  res.end();
  return true;
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
    const validators = setEntityHeaders(res, stats, relPath);
    const choice = requestedRange(req, stats.size, validators);
    if (!answeredWithoutBody(req, res, stats.size, validators, choice)) await streamBytes(req, res, handle, stats.size, choice);
  } finally {
    await handle.close();
  }
}
