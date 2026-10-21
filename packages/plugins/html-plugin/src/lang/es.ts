import type { Messages } from "./messages";

const es: Messages = {
  reload: "Recargar desde el disco",
  saveAsPdf: "Guardar como PDF (abre el diálogo de impresión)",
  pdf: "PDF",
  download: "ZIP",
  downloadZip: "Descargar como zip autónomo (recursos incluidos)",
  downloadError: (error) => `⚠ Error al descargar: ${error}`,
  untitled: "Página HTML",
  editSource: "Editar código HTML",
  cancel: "Cancelar",
  applyChanges: "Aplicar cambios",
  saving: "Guardando...",
  saveError: (error) => `⚠ Error al guardar: ${error}`,
  loadingSource: "Cargando código…",
  sourceError: (error) => `Error al cargar el código: ${error}`,
  submitTitle: "¿Enviar esto a la conversación?",
  submitHint: "La página quiere enviar esto. Edítalo si hace falta: no se envía nada hasta que pulses Enviar.",
  submitSend: "Enviar",
  submitDiscard: "Descartar",
  submitTooLong: (maxChars) => `La página intentó enviar más de ${maxChars} caracteres, así que no se envió nada.`,
};

export default es;
