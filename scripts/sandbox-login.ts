// `yarn sandbox:login`: export the Claude Code login from the macOS Keychain to
// the Claude config dir's .credentials.json with the same item selection the server uses.

import { readFromKeychain, writeCredentialsFile } from "../server/system/credentials.js";
import { classifyCredentials } from "../server/system/credentialsState.js";
import { claudeCredentialsPath } from "../server/utils/claudeConfigPath.js";

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
  console.log(`Credentials exported to ${claudeCredentialsPath()} (token ${verdict.kind}).`);
  return 0;
}

process.exitCode = await main();
