import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

export type Appearance = "light" | "dark";

// The host says how its page is drawn with `data-appearance` on <html> (MulmoTerminal's themes).
// A host that never sets it is light: following the OS's dark preference instead would draw dark
// charts inside a light app.
const readAppearance = (): Appearance =>
  typeof document !== "undefined" && document.documentElement.getAttribute("data-appearance") === "dark" ? "dark" : "light";

/** The host page's appearance, followed while the component is mounted. */
export function useHostAppearance(): Ref<Appearance> {
  const appearance = ref<Appearance>(readAppearance());
  const watcher: { observer: MutationObserver | null } = { observer: null };
  onMounted(() => {
    appearance.value = readAppearance();
    if (typeof MutationObserver === "undefined") return;
    watcher.observer = new MutationObserver(() => (appearance.value = readAppearance()));
    watcher.observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-appearance"] });
  });
  onBeforeUnmount(() => watcher.observer?.disconnect());
  return appearance;
}

/** Utility classes for the chart cards in each appearance. */
export const CARD_CLASSES: Record<Appearance, { card: string; divider: string; title: string; muted: string; button: string; badge: string }> = {
  light: {
    card: "border-gray-200 bg-white",
    divider: "border-gray-100",
    title: "text-gray-800",
    muted: "text-gray-500",
    button: "border-gray-300 text-gray-500 hover:bg-gray-50",
    badge: "bg-blue-50 text-blue-700",
  },
  dark: {
    card: "border-gray-700 bg-gray-900",
    divider: "border-gray-800",
    title: "text-gray-100",
    muted: "text-gray-400",
    button: "border-gray-600 text-gray-300 hover:bg-gray-800",
    badge: "bg-blue-950 text-blue-300",
  },
};

/** The card's colour, behind a PNG: ECharts' dark theme draws on a transparent background here. */
export const EXPORT_BACKGROUND: Record<Appearance, string> = { light: "#ffffff", dark: "#111827" };
