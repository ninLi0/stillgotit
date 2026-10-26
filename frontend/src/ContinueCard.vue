<script setup lang="ts">
import { computed } from "vue";
import PixelIcon from "./PixelIcon.vue";
import { activityLabel, continueOrder, requestSession, type OpenSession } from "./continue-session.ts";

// Home's Continue card: the learner's open lessons and practice tasks in this course (/learning/continue). Selecting a
// row opens that skill's study page on that session. Lessons stay open until a later change closes them, so the card
// shows the few most recent and counts the rest.
const SHOWN = 4;
const props = defineProps<{ sessions: readonly OpenSession[] }>();
const emit = defineEmits<{ open: [skill: string] }>();
const ordered = computed(() => continueOrder(props.sessions));
const shown = computed(() => ordered.value.slice(0, SHOWN));
const more = computed(() => ordered.value.length - shown.value.length);
function open(row: OpenSession) { requestSession(row.skill, row.studySession); emit("open", row.skill); }
</script>

<template>
  <section class="continue card" aria-labelledby="continue-title">
    <h2 id="continue-title" class="display continue-title">Continue</h2>
    <ul class="continue-rows">
      <li v-for="row in shown" :key="row.studySession">
        <button type="button" class="continue-row" @click="open(row)">
          <PixelIcon :name="row.kind === 'LESSON' ? 'school' : 'summit'" :size="28" />
          <span class="continue-text"><strong>{{ row.title }}</strong><small>{{ activityLabel(row) }}</small></span>
          <span class="pill" :class="row.kind === 'LESSON' ? 'review' : 'new'">{{ row.kind === 'LESSON' ? 'Lesson' : 'Practice' }}</span>
          <span class="chev" aria-hidden="true">›</span>
        </button>
      </li>
    </ul>
    <p v-if="more" class="hint continue-more">{{ more }} more {{ more === 1 ? 'is' : 'are' }} open. Open a skill to see all its conversations.</p>
  </section>
</template>

<style scoped>
.continue { margin-top: 18px; padding: 16px 18px; animation: sgRise 240ms ease-out both; }
.continue-title { margin: 0 0 10px; font-size: 21px; }
.continue-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.continue-row { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto 14px; gap: 12px; align-items: center; width: 100%; padding: 12px 14px; border: 0; border-radius: 14px; background: #FFFFFF; box-shadow: 0 0 0 1px var(--ring); color: var(--ink); text-align: left; }
.continue-row:hover { background: var(--inset); }
.continue-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.continue-text strong { font-size: 15px; font-weight: 650; overflow-wrap: anywhere; }
.continue-text small { font-size: 13px; color: var(--muted); }
.chev { color: var(--faint); font-size: 18px; }
.continue-more { margin: 10px 0 0; }
@media (max-width: 520px) { .continue-row { grid-template-columns: 28px minmax(0, 1fr) 14px; } .continue-row .pill { grid-column: 2; justify-self: start; } .chev { grid-column: 3; grid-row: 1; } }
</style>
