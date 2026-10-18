import type { Messages } from "./messages";

const zh: Messages = {
  untitled: "图表",
  chartCount: (count) => `${count} 个图表`,
  chartTitle: (num) => `图表 ${num}`,
  png: "PNG",
  fromSpreadsheet: (range) => `来自表格：${range}`,
  notLinked: "未关联：此宿主无法读取表格。",
  unreadableSource: "无法读取表格范围。",
};

export default zh;
