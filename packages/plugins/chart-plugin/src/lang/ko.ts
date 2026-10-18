import type { Messages } from "./messages";

const ko: Messages = {
  untitled: "차트",
  chartCount: (count) => `${count}개 차트`,
  chartTitle: (num) => `차트 ${num}`,
  png: "PNG",
  fromSpreadsheet: (range) => `스프레드시트에서: ${range}`,
  notLinked: "연결되지 않음: 이 호스트는 스프레드시트를 읽을 수 없습니다.",
  unreadableSource: "스프레드시트 범위를 읽을 수 없습니다.",
};

export default ko;
