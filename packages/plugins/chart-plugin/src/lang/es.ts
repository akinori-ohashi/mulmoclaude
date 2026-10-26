import type { Messages } from "./messages";

const es: Messages = {
  untitled: "Gráfico",
  chartCount: (count) => `${count} gráfico${count === 1 ? "" : "s"}`,
  chartTitle: (num) => `Gráfico ${num}`,
  png: "PNG",
  svg: "SVG",
  csv: "CSV",
  fromSpreadsheet: (range) => `De la hoja de cálculo: ${range}`,
  notLinked: "Sin vincular: este host no puede leer la hoja de cálculo.",
  unreadableSource: "No se pudo leer el rango de la hoja de cálculo.",
  sourceTimedOut: "La hoja de cálculo no respondió a tiempo.",
  cannotDraw: (reason) => `No se pudo dibujar este gráfico: ${reason}`,
};

export default es;
