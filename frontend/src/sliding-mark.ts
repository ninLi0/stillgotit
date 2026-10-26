import { nextTick, onBeforeUnmount, onMounted, ref, type Ref } from "vue";

// A mark that slides from one chosen item to the next (design/visual-design.md, "Motion"): the sidebar's capsule
// behind the current view, and the line under the lesson's chosen tab. The mark is one element placed in the
// container's coordinates, so it moves on the move curve instead of jumping, and it scrolls with a strip that scrolls.
// The container must be positioned, the chosen item must be one of its children, and the mark element carries
// `data-mark`.
export type MarkBox = { x: number; y: number; w: number; h: number };

export function useSlidingMark(container: Ref<HTMLElement | null>, selector: string) {
  /** Where the chosen item is, in the container's coordinates, or null when nothing is chosen. */
  const box = ref<MarkBox | null>(null);
  /** On while the mark may slide. A mark placed for the first time, or after a resize, appears in place. */
  const sliding = ref(false);
  let observer: ResizeObserver | null = null, frame = 0;

  function measure(): MarkBox | null {
    const chosen = container.value?.querySelector<HTMLElement>(selector);
    return chosen ? { x: chosen.offsetLeft, y: chosen.offsetTop, w: chosen.offsetWidth, h: chosen.offsetHeight } : null;
  }
  function same(a: MarkBox | null, b: MarkBox | null) {
    if (!a || !b) return a === b;
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  }
  /** Moves the mark to the chosen item once the page has updated. It slides only when `animate` is set and the mark was
   * already showing; otherwise it appears in place, and the next change can slide. A mark that has only just appeared
   * moves in place even when `animate` is set, and the frames that turn sliding on keep running, so it can slide after. */
  async function place(animate: boolean) {
    await nextTick();
    const next = measure();
    if (animate && box.value && next) box.value = next;
    else {
      cancelAnimationFrame(frame);
      sliding.value = false;
      box.value = next;
      // Two frames later the browser has drawn the mark in place, so the next move can slide.
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { sliding.value = !!box.value; }); });
    }
    observe();
  }
  /** Watches the container and its items, so a change of size (a font loading, a label growing) re-places the mark. */
  function observe() {
    if (typeof ResizeObserver === "undefined" || !container.value) return;
    observer ??= new ResizeObserver(() => { if (!same(measure(), box.value)) void place(false); });
    observer.disconnect();
    observer.observe(container.value);
    // The mark itself (marked data-mark) changes size as it slides, so it is not watched.
    for (const item of Array.from(container.value.children)) if (!item.hasAttribute("data-mark")) observer.observe(item);
  }

  onMounted(() => { void place(false); });
  onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(frame); });
  return { box, sliding, place };
}
