import type { Messages } from "./messages";

const de: Messages = {
  untitled: "Diagramm",
  chartCount: (count) => `${count} Diagramm${count === 1 ? "" : "e"}`,
  chartTitle: (num) => `Diagramm ${num}`,
  png: "PNG",
  fromSpreadsheet: (range) => `Aus der Tabelle: ${range}`,
  notLinked: "Nicht verknüpft: Dieser Host kann die Tabelle nicht lesen.",
  unreadableSource: "Der Tabellenbereich konnte nicht gelesen werden.",
  sourceTimedOut: "Die Tabelle hat nicht rechtzeitig geantwortet.",
};

export default de;
