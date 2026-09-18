export const SLACK_MESSAGE_CHUNK_SIZE = 4000;

export function chunkSlackMessage(text: string, maxLength = SLACK_MESSAGE_CHUNK_SIZE): string[] {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new Error("Slack message chunk length must be a positive integer.");
  }
  if (text.length === 0) return ["(empty reply)"];

  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += maxLength) {
    chunks.push(text.slice(offset, offset + maxLength));
  }
  return chunks;
}
