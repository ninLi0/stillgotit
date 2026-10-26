import { onBeforeUnmount, ref, watch, type Ref } from "vue";
import { readCurve, timeToReach } from "./motion.ts";

/**
 * The width of `box` in whole CSS pixels, kept current as the box resizes, as the charts lay themselves out. The box may
 * appear after the component mounts, such as a chart shown once a read answers, so the observer follows the element.
 */
export function useBoxWidth(box: Ref<HTMLElement | null>, initial = 320) {
  const width = ref(initial);
  let observer: ResizeObserver | null = null;
  function measure() {
    const w = Math.floor(box.value?.clientWidth ?? 0);
    if (w > 0 && w !== width.value) width.value = w;
  }
  watch(box, (element) => {
    observer?.disconnect(); observer = null;
    if (!element) return;
    measure();
    if (typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(measure); observer.observe(element); }
  }, { immediate: true, flush: "post" });
  onBeforeUnmount(() => observer?.disconnect());
  return width;
}

/**
 * The style that makes a mark appear as a drawing line reaches it: `reach` is the share of the line's length at the mark,
 * turned into the share of the draw's duration on the entrance curve (motion.ts). A mark at the very end waits for 98%,
 * because the line's last pixels land so softly that a later mark would look late.
 */
export function arrivalStyle() {
  const entrance = readCurve("--ease-enter");
  return (reach: number) => ({ "--arrive": timeToReach(entrance, Math.min(reach, 0.98)).toFixed(3) });
}
