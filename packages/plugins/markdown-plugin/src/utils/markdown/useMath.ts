// Companion to `useMermaid.ts` — same shape, same reason for living in
// the plugin rather than the host: keeps the host Vue tree out of the
// plugin bundle.

import { onMounted, watch, nextTick, type Ref } from "vue";
import { renderMathNodes, type MathRenderLabels } from "@mulmoclaude/markdown-utils/markdown/mathRender";
import { useT } from "../../lang";

export function useMathRenderer(containerRef: Ref<HTMLElement | null | undefined>, sourceRef: Ref<unknown>): void {
  const t = useT();
  const labels: MathRenderLabels = {
    loadFailed: (error) => t("mathLoadFailed", { error }),
    renderFailed: (error) => t("mathRenderFailed", { error }),
  };
  const run = async (): Promise<void> => {
    await nextTick();
    await renderMathNodes(containerRef.value ?? null, labels);
  };
  onMounted(() => {
    void run();
  });
  watch(sourceRef, () => void run(), { flush: "post" });
}
