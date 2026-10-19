<template>
  <!-- The iframe is laid out at the script's canvas size, so `100vh` inside it means what it does in the PNG
       render, and is scaled down to the box from the outside. -->
  <div
    ref="box"
    class="relative w-full overflow-hidden aspect-[var(--beat-aspect)]"
    :style="{
      '--beat-aspect': `${canvas.width} / ${canvas.height}`,
      '--beat-w': `${canvas.width}px`,
      '--beat-h': `${canvas.height}px`,
      '--beat-scale': String(scale),
    }"
  >
    <iframe
      :srcdoc="srcdoc"
      sandbox="allow-scripts"
      class="absolute top-0 left-0 border-0 bg-white origin-top-left w-[var(--beat-w)] h-[var(--beat-h)] scale-[var(--beat-scale)]"
      :class="{ 'pointer-events-none': !interactive }"
      :title="title"
      :data-testid="testid"
    />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { CanvasSize } from "../beatHtml";

const props = defineProps<{
  srcdoc: string;
  canvas: CanvasSize;
  title: string;
  testid?: string;
  interactive?: boolean;
}>();

const box = ref<HTMLDivElement>();
const scale = ref(1);
let observer: ResizeObserver | null = null;

function measure(): void {
  const width = box.value?.clientWidth ?? 0;
  if (width > 0) scale.value = width / props.canvas.width;
}

onMounted(() => {
  measure();
  observer = new ResizeObserver(measure);
  if (box.value) observer.observe(box.value);
});

watch(() => props.canvas.width, measure);

onBeforeUnmount(() => observer?.disconnect());
</script>
