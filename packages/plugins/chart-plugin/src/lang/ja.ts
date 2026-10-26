import type { Messages } from "./messages";

const ja: Messages = {
  untitled: "チャート",
  chartCount: (count) => `${count} チャート`,
  chartTitle: (num) => `チャート ${num}`,
  png: "PNG",
  svg: "SVG",
  csv: "CSV",
  fromSpreadsheet: (range) => `表から: ${range}`,
  notLinked: "表とつながっていません（このホストは表を読めません）。",
  unreadableSource: "表の範囲を読めませんでした。",
  sourceTimedOut: "表の読み込みが時間内に終わりませんでした。",
  cannotDraw: (reason) => `このグラフは描けませんでした: ${reason}`,
};

export default ja;
