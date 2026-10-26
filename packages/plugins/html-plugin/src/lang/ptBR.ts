import type { Messages } from "./messages";

const ptBR: Messages = {
  reload: "Recarregar do disco",
  saveAsPdf: "Salvar como PDF (abre o diálogo de impressão)",
  pdf: "PDF",
  download: "ZIP",
  downloadZip: "Baixar como zip autônomo (recursos incluídos)",
  downloadError: (error) => `⚠ Falha no download: ${error}`,
  untitled: "Página HTML",
  editSource: "Editar fonte HTML",
  cancel: "Cancelar",
  applyChanges: "Aplicar alterações",
  saving: "Salvando...",
  saveError: (error) => `⚠ Falha ao salvar: ${error}`,
  loadingSource: "Carregando fonte…",
  sourceError: (error) => `Falha ao carregar a fonte: ${error}`,
  submitTitle: "Enviar isto para a conversa?",
  submitHint: "A página quer enviar isto. Edite se precisar — nada é enviado até você clicar em Enviar.",
  submitSend: "Enviar",
  submitDiscard: "Descartar",
  submitTooLong: (maxChars) => `A página tentou enviar mais de ${maxChars} caracteres, então nada foi enviado.`,
  submitSent: "Enviado para a conversa.",
  submitFailed: "Não foi possível enviar: o terminal não está conectado. O texto continua aqui; clique em Enviar para tentar de novo.",
};

export default ptBR;
