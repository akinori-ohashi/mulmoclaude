import type { Messages } from "./messages";

const zh: Messages = {
  reload: "从磁盘重新加载",
  saveAsPdf: "另存为 PDF(打开打印对话框)",
  pdf: "PDF",
  download: "ZIP",
  downloadZip: "下载为自包含 zip(含资源)",
  downloadError: (error) => `⚠ 下载失败：${error}`,
  untitled: "HTML 页面",
  editSource: "编辑 HTML 源代码",
  cancel: "取消",
  applyChanges: "应用更改",
  saving: "保存中...",
  saveError: (error) => `⚠ 保存失败：${error}`,
  loadingSource: "正在加载源代码…",
  sourceError: (error) => `加载源代码失败：${error}`,
  submitTitle: "要把这段内容发送到对话吗？",
  submitHint: "页面想发送这段内容。可按需修改——点击“发送”之前不会发送任何内容。",
  submitSend: "发送",
  submitDiscard: "丢弃",
  submitTooLong: (maxChars) => `页面试图发送超过 ${maxChars} 个字符的内容，因此未发送。`,
  submitSent: "已发送到对话。",
  submitFailed: "发送失败：终端未连接。内容已保留在此，请再次点击“发送”。",
};

export default zh;
