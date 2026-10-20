import type { Messages } from "./messages";

const en: Messages = {
  untitled: "Chart",
  chartCount: (count) => `${count} chart${count === 1 ? "" : "s"}`,
  chartTitle: (num) => `Chart ${num}`,
  png: "PNG",
  svg: "SVG",
  csv: "CSV",
  fromSpreadsheet: (range) => `From the spreadsheet: ${range}`,
  notLinked: "Not linked: this host cannot read the spreadsheet.",
  unreadableSource: "The spreadsheet range could not be read.",
  sourceTimedOut: "The spreadsheet did not answer in time.",
  cannotDraw: (reason) => `Could not draw this chart: ${reason}`,
};

export default en;
