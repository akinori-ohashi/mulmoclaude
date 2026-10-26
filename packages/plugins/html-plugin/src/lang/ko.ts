import type { Messages } from "./messages";

const ko: Messages = {
  reload: "디스크에서 다시 불러오기",
  saveAsPdf: "PDF 로 저장 (인쇄 대화 상자 열기)",
  pdf: "PDF",
  download: "ZIP",
  downloadZip: "자체 포함 zip으로 다운로드(에셋 포함)",
  downloadError: (error) => `⚠ 다운로드 실패: ${error}`,
  untitled: "HTML 페이지",
  editSource: "HTML 소스 편집",
  cancel: "취소",
  applyChanges: "변경 사항 적용",
  saving: "저장 중...",
  saveError: (error) => `⚠ 저장 실패: ${error}`,
  loadingSource: "소스를 불러오는 중…",
  sourceError: (error) => `소스 로드 실패: ${error}`,
  submitTitle: "이 내용을 대화로 보낼까요?",
  submitHint: "페이지가 이 내용을 보내려고 합니다. 필요하면 수정하세요. 보내기를 누르기 전에는 전송되지 않습니다.",
  submitSend: "보내기",
  submitDiscard: "버리기",
  submitTooLong: (maxChars) => `페이지가 ${maxChars}자를 넘는 내용을 보내려고 해서 전송하지 않았습니다.`,
  submitSent: "대화로 보냈습니다.",
  submitFailed: "보내지 못했습니다. 터미널이 연결되어 있지 않습니다. 내용은 여기에 남겨 두었으니 다시 보내기를 누르세요.",
};

export default ko;
