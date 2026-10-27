<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import InfoBubble from "./InfoBubble.vue";

// The review of suggested skills in Materials, one item at a time, like a deck of cards. CourseWorkspace.vue owns the
// items, the saves and the draft save queue; this component draws the deck and edits the item on screen in place.
// `done` counts the items confirmed or discarded since the deck opened, so the strip can show them as filled squares.
const props = defineProps<{
  items: readonly { kind: "suggestion" | "draft"; key: string }[];
  at: number; done: number; kind: "suggestion" | "draft";
  fields: { title: string; outcome: string; gate: string } | null | undefined;
  units: readonly { unit: string; title: string }[];
  sourceTitle: string; tutor: string; unsaved: number;
  busy: boolean; discardReason: string; canLater: boolean;
}>();
const emit = defineEmits<{ go: [index: number]; discard: []; saveDraft: []; saveAll: []; confirm: []; later: [] }>();
// The chosen topic: a unit id, or "" for a new topic named by newTopic. Only a new suggestion can start a new topic.
const topic = defineModel<string>("topic", { required: true });
const newTopic = defineModel<string>("newTopic", { required: true });

const uid = Math.random().toString(36).slice(2, 8);
const ids = { title: `review-name-${uid}`, topic: `review-topic-${uid}`, outcome: `review-outcome-${uid}`, gate: `review-gate-${uid}` };
const total = computed(() => props.done + props.items.length);
const position = computed(() => props.done + props.at + 1);
const first = computed(() => props.at <= 0), last = computed(() => props.at >= props.items.length - 1);
function step(by: number) { const next = props.at + by; if (next >= 0 && next < props.items.length) emit("go", next); }

// The skill name is the card's title. It wraps like a heading, so it is a one-line textarea that grows with its text.
const titleField = ref<HTMLTextAreaElement | null>(null);
const sizesItself = typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content");
function grow() {
  const field = titleField.value; if (!field || sizesItself) return;
  field.style.height = "auto"; field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
}
function titleKey(event: KeyboardEvent) { if (event.key === "Enter" && !event.isComposing) event.preventDefault(); }
function titleInput() { if (props.fields && /[\r\n]/.test(props.fields.title)) props.fields.title = props.fields.title.replace(/\s*[\r\n]+\s*/g, " "); grow(); }
watch(() => [props.fields, props.fields?.title], () => void nextTick(grow));
let observer: ResizeObserver | undefined, width = 0;
onMounted(() => {
  grow();
  if (sizesItself || typeof ResizeObserver === "undefined" || !titleField.value) return;
  observer = new ResizeObserver(([entry]) => { const now = entry?.contentRect.width ?? 0; if (now !== width) { width = now; grow(); } });
  observer.observe(titleField.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <section class="review" aria-labelledby="review-title">
    <header class="review-head">
      <h2 id="review-title" class="display" tabindex="-1">Review suggested skills</h2>
      <InfoBubble text="Edit each suggestion to match what your course expects. Confirming saves it and adds it as a leaf on your tree. Discard drops a new suggestion, or deletes a saved draft from this course with its requirements. A discarded draft can't be brought back." />
      <button v-if="canLater" type="button" class="quiet later" @click="emit('later')">Later</button>
    </header>

    <div class="deck">
      <div class="place">
        <p class="eyebrow count" aria-live="polite">Suggestion {{ position }} of {{ total }}</p>
        <span class="strip" role="group" :aria-label="done ? `Suggestions, ${done} done` : 'Suggestions'">
          <span v-for="n in done" :key="`done-${n}`" class="cell done" aria-hidden="true"></span>
          <button v-for="(item, i) in items" :key="item.key" type="button" class="cell" :class="{ current: i === at, saved: item.kind === 'draft' }"
            :aria-label="`Suggestion ${done + i + 1} of ${total}${item.kind === 'draft' ? ', saved draft' : ''}`" :aria-current="i === at ? 'step' : undefined" @click="emit('go', i)"></button>
        </span>
        <span class="steps">
          <button type="button" class="step" aria-label="Previous suggestion" :aria-disabled="first" @click="step(-1)">
            <svg width="9" height="15" viewBox="0 0 3 5" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M2 0h1v1H2zM1 1h1v1H1zM0 2h1v1H0zM1 3h1v1H1zM2 4h1v1H2z" /></svg>
          </button>
          <button type="button" class="step" aria-label="Next suggestion" :aria-disabled="last" @click="step(1)">
            <svg width="9" height="15" viewBox="0 0 3 5" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M0 0h1v1H0zM1 1h1v1H1zM2 2h1v1H2zM1 3h1v1H1zM0 4h1v1H0z" /></svg>
          </button>
        </span>
      </div>
      <button v-if="unsaved > 1" type="button" class="quiet save-all" :disabled="busy" @click="emit('saveAll')">Save all {{ unsaved }} as drafts</button>
    </div>

    <div class="review-card card">
      <p class="eyebrow kind">{{ kind === 'draft' ? 'Saved draft' : 'New suggestion' }}</p>
      <template v-if="fields">
        <label class="sr-only" :for="ids.title">Skill name</label>
        <textarea :id="ids.title" ref="titleField" v-model="fields.title" class="title-field" rows="1" maxlength="160" spellcheck="true" :disabled="busy" @keydown="titleKey" @input="titleInput" />
        <p v-if="sourceTitle" class="source">From <cite>{{ sourceTitle }}</cite></p>
        <p v-if="tutor" class="tutor-label">{{ tutor }}</p>

        <fieldset class="field" :disabled="busy" :aria-describedby="`${ids.topic}-hint`">
          <legend class="field-label">Topic</legend>
          <p :id="`${ids.topic}-hint`" class="field-hint">Where its leaf grows on your tree.</p>
          <div class="pills">
            <label v-for="item in units" :key="item.unit" class="pill-choice"><input v-model="topic" type="radio" :name="ids.topic" :value="item.unit" /><span><i aria-hidden="true"></i>{{ item.title }}</span></label>
            <label v-if="kind === 'suggestion'" class="pill-choice new"><input v-model="topic" type="radio" :name="ids.topic" value="" /><span><i aria-hidden="true"></i>New topic…</span></label>
          </div>
          <label v-if="kind === 'suggestion' && !topic" class="new-topic">New topic name<input v-model="newTopic" type="text" maxlength="160" /></label>
        </fieldset>

        <div class="field">
          <div class="field-head"><label class="field-label" :for="ids.outcome">What you should be able to do</label><InfoBubble label="About the outcome" text="Start with a verb and name something you could show, such as “Compute a matrix product and explain how its entries are formed.”" /></div>
          <p :id="`${ids.outcome}-hint`" class="field-hint">What you can do once you have this skill.</p>
          <textarea :id="ids.outcome" v-model="fields.outcome" rows="2" :aria-describedby="`${ids.outcome}-hint`" :disabled="busy" />
        </div>
        <div class="field">
          <div class="field-head"><label class="field-label" :for="ids.gate">How you will demonstrate it</label><InfoBubble label="About the requirements" text="Each practice task asks for all of this, and your answer is checked against it. A good one asks for two new problems solved with your reasoning, plus a why or how question." /></div>
          <p :id="`${ids.gate}-hint`" class="field-hint">What practice will ask you to show.</p>
          <textarea :id="ids.gate" v-model="fields.gate" rows="3" :aria-describedby="`${ids.gate}-hint`" :disabled="busy" />
        </div>
      </template>

      <div class="actions">
        <span class="discard-wrap"><button type="button" class="quiet discard" :disabled="busy || !!discardReason" :aria-describedby="discardReason ? 'discard-reason' : undefined" @click="emit('discard')">Discard</button><p v-if="discardReason" id="discard-reason" class="hint reason">{{ discardReason }}</p></span>
        <button v-if="kind === 'suggestion'" type="button" class="secondary sand" :disabled="busy" @click="emit('saveDraft')">Save as draft</button>
        <button type="button" class="primary sand confirm" :disabled="busy" @click="emit('confirm')">{{ busy ? 'Saving…' : 'Confirm · add a leaf' }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* The hierarchy of Manage skills: the section's display-face title, then a quiet eyebrow line that keeps the place in
   the deck, then one card whose title is the skill name. Inside the card, each field has a 14 px label, a one-line hint
   and, for anything longer, an ⓘ. Discard is quiet at the left; Save as draft and Confirm sit at the right, ranked. */
.review { max-width: 760px; margin: 0 0 18px; animation: sgRise var(--dur-enter) var(--ease-enter) both; }
.review-head { position: relative; display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; }
.review-head h2 { margin: 0; font-size: 22px; }
.later { margin-left: auto; }

/* The place in the deck: "Suggestion 2 of 5", one square per item, and the arrows. Save all sits at the right. */
.deck { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; margin: 12px 0 10px; }
.place { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; min-width: 0; }
.count { white-space: nowrap; }
.strip { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.cell { display: block; flex: none; width: 12px; height: 12px; padding: 0; border: 0; border-radius: 0; background: var(--ring); }
.cell.saved { background: var(--sand-nav); }
.cell.done { background: var(--sand-note); }
.cell.current { background: var(--sand-soft); box-shadow: inset 0 0 0 2px var(--sand-note); }
button.cell:hover { box-shadow: inset 0 0 0 2px var(--check-line); }
button.cell.current:hover { box-shadow: inset 0 0 0 2px var(--sand-note); }
.steps { display: inline-flex; gap: 4px; }
.step { display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 8px; background: var(--card); box-shadow: inset 0 0 0 1px var(--ring); color: var(--soft); }
.step:hover:not([aria-disabled="true"]) { background: var(--inset); color: var(--ink); }
.step[aria-disabled="true"] { color: var(--disabled); cursor: default; }
.save-all { margin-left: auto; padding: 4px 0; font-size: 13px; color: var(--soft); }

/* The card: the item's kind, its name as the title, where it came from, then the fields. */
.review-card { padding: 20px 22px 18px; }
.kind { margin: 0 0 4px; }
.title-field {
  display: block; width: calc(100% + 16px); margin: 0 0 0 -8px; padding: 2px 6px; overflow: hidden; resize: none; field-sizing: content;
  border: 2px solid transparent; border-bottom: 2px dashed var(--faint); border-radius: 8px 8px 0 0; background: transparent; color: var(--ink);
  font-family: var(--font-display); font-size: 26px; font-weight: 500; line-height: 1.25; overflow-wrap: anywhere;
}
.title-field:hover:not(:disabled) { background: var(--inset); }
.title-field:focus-visible { border: 2px solid var(--focus); border-radius: 8px; background: var(--field); }
.source { margin: 10px 0 0; padding: 1px 0 1px 10px; border-left: 3px solid var(--sand-line); color: var(--muted); font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
.source cite { font-style: normal; font-weight: 600; color: var(--soft); }
.tutor-label { margin: 6px 0 0; }

.field { margin: 22px 0 0; padding: 0; border: 0; min-width: 0; }
.field-head { position: relative; display: flex; align-items: center; gap: 2px; }
/* An ⓘ bubble opens under the whole label row, so it never runs past the card's right edge on a phone. */
.field-head :deep(.info-wrap), .review-head :deep(.info-wrap) { position: static; }
.field-head :deep(.info-bubble), .review-head :deep(.info-bubble) { max-width: 100%; }
.field-label { display: block; margin: 0; padding: 0; font-size: 14px; font-weight: 600; color: var(--ink); }
.field-hint { margin: 2px 0 8px; font-size: 13px; color: var(--muted); }
textarea:not(.title-field) { display: block; width: 100%; padding: 9px 12px; border: 1px solid var(--faint); border-radius: 10px; background: var(--field); color: var(--ink); font: inherit; font-size: 14px; line-height: 1.5; resize: vertical; }

/* Topic pills: a radio group drawn as pills, with a small square that fills when chosen. */
.pills { display: flex; flex-wrap: wrap; gap: 8px; }
.pill-choice { position: relative; display: inline-flex; margin: 0; font-size: 13px; font-weight: 600; }
.pill-choice input { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; margin: 0; padding: 0; border: 0; opacity: 0; cursor: pointer; }
.pill-choice span { display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 14px 0 12px; border-radius: 999px; background: var(--card); box-shadow: inset 0 0 0 1px var(--line-strong); color: var(--soft); overflow-wrap: anywhere; }
.pill-choice i { flex: none; width: 8px; height: 8px; box-shadow: inset 0 0 0 2px var(--check-line); }
.pill-choice.new span { box-shadow: none; outline: 1px dashed var(--line-strong); outline-offset: -1px; }
.pill-choice:hover input:not(:disabled) + span { background: var(--inset); color: var(--ink); }
.pill-choice input:checked + span { background: var(--sand-soft); box-shadow: inset 0 0 0 2px var(--sand-soft-text); outline: 0; color: var(--sand-soft-text); }
.pill-choice input:checked + span i { background: var(--sand-soft-text); box-shadow: none; }
.pill-choice input:focus-visible + span { outline: 2px solid var(--focus); outline-offset: 2px; }
.pill-choice input:disabled { cursor: not-allowed; }
.pill-choice input:disabled + span { opacity: .55; }
.new-topic { display: block; max-width: 380px; margin: 12px 0 0; font-size: 13px; font-weight: 600; }
.new-topic input { min-height: 40px; margin-top: 6px; padding: 8px 12px; border-radius: 10px; font-size: 14px; font-weight: 400; }

/* Actions, ranked: Discard is quiet at the left, Save as draft is secondary, and Confirm is the one sand primary. */
.actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 10px 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--line); }
.discard-wrap { margin-right: auto; }
.discard { font-size: 14px; color: var(--soft); }
.actions .primary { margin-bottom: 3px; }

@media (max-width: 520px) {
  .review-card { padding: 16px; }
  .title-field { font-size: 22px; }
  .save-all { margin-left: 0; }
  .actions .confirm { flex: 1 1 100%; }
}
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
</style>
