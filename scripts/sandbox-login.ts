// `yarn sandbox:login`: export the Claude Code login from the macOS Keychain to
// ~/.claude/.credentials.json with the same item selection the server uses.

import { readFromKeychain, writeCredentialsFile } from "../server/system/credentials.js";
import { classifyCredentials } from "../server/system/credentialsState.js";

async function main(): Promise<number> {
  const credentials = await readFromKeychain();
  if (credentials === null) {
    console.error("No 'Claude Code-credentials' item in the macOS Keychain. Run `claude /login` first.");
    return 1;
  }
  const verdict = classifyCredentials(credentials, Date.now());
  if (verdict.kind === "unusable") {
    console.error(`The Keychain login cannot be used (${verdict.reason}). Run \`claude /login\` first.`);
    return 1;
  }
  await writeCredentialsFile(credentials);
  console.log(`Credentials exported to ~/.claude/.credentials.json (token ${verdict.kind}).`);
  return 0;
}

process.exitCode = await main();
