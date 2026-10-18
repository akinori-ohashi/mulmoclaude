import type { Messages } from "./messages";

const ptBR: Messages = {
  untitled: "Gráfico",
  chartCount: (count) => `${count} gráfico${count === 1 ? "" : "s"}`,
  chartTitle: (num) => `Gráfico ${num}`,
  png: "PNG",
  fromSpreadsheet: (range) => `Da planilha: ${range}`,
  notLinked: "Não vinculado: este host não consegue ler a planilha.",
  unreadableSource: "Não foi possível ler o intervalo da planilha.",
};

export default ptBR;
