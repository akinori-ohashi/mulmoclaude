import type { Messages } from "./messages";

const fr: Messages = {
  untitled: "Graphique",
  chartCount: (count) => `${count} graphique${count === 1 ? "" : "s"}`,
  chartTitle: (num) => `Graphique ${num}`,
  png: "PNG",
  fromSpreadsheet: (range) => `Depuis la feuille de calcul : ${range}`,
  notLinked: "Non lié : cet hôte ne peut pas lire la feuille de calcul.",
  unreadableSource: "La plage de la feuille de calcul n’a pas pu être lue.",
  sourceTimedOut: "Le tableur n’a pas répondu à temps.",
};

export default fr;
