import type { Messages } from "./messages";

const ja: Messages = {
  reload: "ファイルを再読み込み",
  saveAsPdf: "PDF として保存（印刷ダイアログを開きます）",
  pdf: "PDF",
  download: "ZIP",
  downloadZip: "自己完結zipでダウンロード（アセット同梱）",
  downloadError: (error) => `⚠ ダウンロード失敗: ${error}`,
  untitled: "HTML ページ",
  editSource: "HTML ソースを編集",
  cancel: "キャンセル",
  applyChanges: "変更を適用",
  saving: "保存中...",
  saveError: (error) => `⚠ 保存に失敗しました: ${error}`,
  loadingSource: "ソースを読み込み中…",
  sourceError: (error) => `ソースの読み込みに失敗しました: ${error}`,
  submitTitle: "この内容を会話に送りますか？",
  submitHint: "ページがこの内容を送ろうとしています。必要なら書き換えてください。「送信」を押すまで送られません。",
  submitSend: "送信",
  submitDiscard: "破棄",
  submitTooLong: (maxChars) => `ページが ${maxChars} 文字を超える内容を送ろうとしたため、送っていません。`,
};

export default ja;
