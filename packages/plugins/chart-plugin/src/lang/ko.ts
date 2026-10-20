import type { Messages } from "./messages";

const ko: Messages = {
  untitled: "차트",
  chartCount: (count) => `${count}개 차트`,
  chartTitle: (num) => `차트 ${num}`,
  png: "PNG",
  svg: "SVG",
  csv: "CSV",
  fromSpreadsheet: (range) => `스프레드시트에서: ${range}`,
  notLinked: "연결되지 않음: 이 호스트는 스프레드시트를 읽을 수 없습니다.",
  unreadableSource: "스프레드시트 범위를 읽을 수 없습니다.",
  sourceTimedOut: "스프레드시트가 제때 응답하지 않았습니다.",
  cannotDraw: (reason) => `이 차트를 그릴 수 없습니다: ${reason}`,
};

export default ko;
