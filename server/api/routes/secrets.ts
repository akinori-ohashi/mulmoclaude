// Settings → the secret store (#871).
//
// The value never travels back: GET answers "is one configured, and which
// source is in effect", not what it is. Settings has no use for the key it
// already sent, and a response that carries it puts the credential through
// the request log, the browser's network panel and any proxy in between for
// no gain. That is a deliberate difference from `googleMapsApiKey`, which
// rides in `/api/config` in full.
//
// PUT sets, DELETE clears. Both take the key from a fixed list rather than
// the request path, so nothing here can address a file we did not name.

import { Router, type Request, type Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { geminiApiKey } from "../../system/env.js";
import { secretsAppliedAtBoot } from "../../system/loadEnv.js";
import { log } from "../../system/logger/index.js";
import {
  deleteStoredSecret,
  isSecretKey,
  secretSource,
  validateSecretValue,
  writeStoredSecret,
  type SecretKey,
  type SecretRejection,
  type SecretSource,
} from "../../system/secrets.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, serverError, type ApiResponse } from "../../utils/httpError.js";
import { isRecord } from "../../utils/types.js";

const LOG_PREFIX = "secrets";

export interface SecretStatus {
  key: SecretKey;
  configured: boolean;
  source: SecretSource;
}

export interface SecretsResponse {
  secrets: SecretStatus[];
}

interface SecretPutBody {
  key: string;
  value: string;
}

function isSecretPutBody(body: unknown): body is SecretPutBody {
  return isRecord(body) && typeof body.key === "string" && typeof body.value === "string";
}

/** The status of every key Settings can manage. Computed per request: the
 *  store is a few small files, and a cache here would report the state as
 *  of the last save rather than the state on disk. */
function statusOf(key: SecretKey): SecretStatus {
  const source = secretSource(key, process.env);
  return { key, configured: source !== "none", source };
}

function buildResponse(): SecretsResponse {
  return { secrets: [statusOf("GEMINI_API_KEY")] };
}

const REJECTION_MESSAGES: Record<SecretRejection, string> = {
  empty: "The value is empty. Use DELETE to clear a stored secret.",
  "too-long": "The value is too long to be an API key.",
  "control-characters": "The value contains a line break or control character — check the paste.",
};

/** Mirror the saved value into this process's environment so it takes
 *  effect without a restart, for the server's own Gemini calls and for
 *  every child process spawned from here on. Processes already running keep
 *  the environment they were started with. */
function applyToProcessEnv(key: SecretKey, value: string | undefined): void {
  // `Reflect.deleteProperty` rather than `delete process.env[key]`: the key is
  // a variable, and assigning `undefined` would not clear the variable — Node
  // stringifies it, leaving the literal "undefined" as the key's value.
  if (value === undefined) Reflect.deleteProperty(process.env, key);
  else process.env[key] = value;
}

const router = Router();

router.get(API_ROUTES.secrets, (_req: Request, res: Response<SecretsResponse>) => {
  res.json(buildResponse());
});

router.put(API_ROUTES.secrets, (req: Request<unknown, unknown, SecretPutBody>, res: ApiResponse<SecretsResponse>) => {
  const { body } = req;
  if (!isSecretPutBody(body) || !isSecretKey(body.key)) {
    log.warn(LOG_PREFIX, "PUT: invalid payload");
    badRequest(res, "Invalid secret payload");
    return;
  }
  const validation = validateSecretValue(body.value);
  if (!validation.ok) {
    // The key name is safe to log; the value never is.
    log.warn(LOG_PREFIX, "PUT: value rejected", { key: body.key, reason: validation.reason });
    badRequest(res, REJECTION_MESSAGES[validation.reason]);
    return;
  }
  try {
    writeStoredSecret(body.key, validation.value);
  } catch (err) {
    log.error(LOG_PREFIX, "PUT: write failed", { key: body.key, error: errorMessage(err) });
    serverError(res, "Failed to store the secret");
    return;
  }
  applyToProcessEnv(body.key, validation.value);
  log.info(LOG_PREFIX, "PUT: stored", { key: body.key });
  res.json(buildResponse());
});

router.delete(API_ROUTES.secrets, (req: Request<unknown, unknown, { key?: unknown }>, res: ApiResponse<SecretsResponse>) => {
  const key = req.body?.key;
  if (!isSecretKey(key)) {
    log.warn(LOG_PREFIX, "DELETE: invalid key");
    badRequest(res, "Invalid secret key");
    return;
  }
  try {
    deleteStoredSecret(key);
  } catch (err) {
    log.error(LOG_PREFIX, "DELETE: remove failed", { key, error: errorMessage(err) });
    serverError(res, "Failed to clear the secret");
    return;
  }
  // Clearing the GUI value hands the key back to whatever the shell set at
  // boot, if anything. "GUI when set, else the environment" has to hold on
  // the way out too, or clearing a key the shell also defines would report
  // "not configured" while every child process still receives one.
  applyToProcessEnv(key, secretsAppliedAtBoot().replaced[key]);
  log.info(LOG_PREFIX, "DELETE: cleared", { key, remaining: geminiApiKey() !== undefined });
  res.json(buildResponse());
});

export default router;
