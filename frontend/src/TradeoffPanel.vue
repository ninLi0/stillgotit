<script setup lang="ts">
import { computed, useId } from "vue";
import { planDay, planDayLabel } from "./labels.ts";
import { confirmReason, daysUntil, type Cut, type Proposal, type ProposalItem } from "./planning.ts";
// A proposed plan that waits for the learner. Nothing changes until they confirm; the parent sends the decision.
const props = defineProps<{ proposal: Proposal; items: ProposalItem[]; cuts: { cut: Cut; label: string }[]; today: string; hasActivePlan: boolean; busy: boolean }>();
const emit = defineEmits<{ confirm: []; decline: [] }>();
const id = useId();
const blocked = computed(() => confirmReason(props.proposal));
// On the exam day no study day remains, so unfinished preparation is listed as cuts.
const examDay = computed(() => props.proposal.focusExamDate === props.today);
const examDistance = computed(() => {
  const days = daysUntil(props.proposal.focusExamDate, props.today);
  return days === null || days < 0 ? "" : days === 0 ? " (today)" : ` (in ${days} ${days === 1 ? "day" : "days"})`;
});
const minutes = (value: number) => `${Math.round(value)} min`;
</script>
<template>
  <section class="tradeoffs" :aria-labelledby="`${id}-title`">
    <p class="eyebrow">Needs your decision</p>
    <h3 :id="`${id}-title`">Review the proposed plan</h3>
    <p>{{ proposal.explanation }}</p>
    <dl class="facts">
      <div><dt>Exam date</dt><dd>{{ planDay(proposal.focusExamDate) }}{{ examDistance }}</dd></div>
      <div><dt>Preparation needed</dt><dd>About {{ minutes(proposal.estimatedExamMinutes) }}</dd></div>
      <div><dt>Time available before the exam</dt><dd>{{ minutes(proposal.availableExamMinutes) }}</dd></div>
      <div><dt>Urgent</dt><dd>{{ proposal.examUrgent ? 'Yes' : 'No' }}</dd></div>
    </dl>
    <p v-if="proposal.examUrgent" class="hint">In an urgent plan, exam activities can start before their prerequisites are ready.</p>
    <template v-if="cuts.length">
      <h4>What would be left out</h4>
      <ul class="cuts">
        <li v-for="row in cuts" :key="`${row.cut.exam}:${row.cut.candidateKey}`"><p class="cut-title"><strong>{{ row.label }}</strong> · {{ minutes(row.cut.minutes) }}</p><p>{{ row.cut.reason }}</p><p class="hint">{{ row.cut.consequence }}</p></li>
      </ul>
    </template>
    <details v-if="items.length" class="schedule">
      <summary>What the plan would schedule ({{ items.length }})</summary>
      <ol><li v-for="row in items" :key="row.item">{{ planDayLabel(row.day, today) }} · {{ row.candidate.activity }} · {{ row.candidate.minutes }} min<template v-if="row.candidate.examRefs.length"> · exam preparation</template></li></ol>
    </details>
    <p v-else class="hint">The proposed plan schedules no activities.</p>
    <p v-if="examDay" class="hint">This preparation was not finished before the exam. Routine updates for this course wait until you confirm.</p>
    <p class="hint">Nothing changes until you confirm. {{ hasActivePlan ? 'Your current plan stays in use.' : 'No plan starts until then.' }}</p>
    <div class="decision">
      <button class="primary" :disabled="busy || !!blocked" :aria-describedby="blocked ? `${id}-blocked` : undefined" @click="emit('confirm')">Confirm tradeoffs</button>
      <button class="quiet" :disabled="busy" @click="emit('decline')">Keep current plan</button>
    </div>
    <p v-if="blocked" :id="`${id}-blocked`" class="hint blocked">{{ blocked }}</p>
  </section>
</template>
<style scoped>
.tradeoffs{margin:12px 0 16px;padding:14px;border:1px solid var(--light);border-radius:12px;background:var(--surface);overflow-wrap:anywhere}
.tradeoffs p{margin:4px 0;font-size:13px}
.eyebrow{text-transform:uppercase;font-size:11px!important;letter-spacing:1px;color:var(--primary);font-weight:600}
h3{font-size:15px;margin:2px 0 6px}
h4{font-size:13px;margin:14px 0 4px}
.facts{margin:10px 0 0;font-size:13px}
.facts div{display:flex;flex-wrap:wrap;gap:0 6px;padding:5px 0;border-top:1px solid var(--wash)}
.facts dt{color:var(--muted)}
.facts dt::after{content:":"}
.facts dd{margin:0;font-weight:600}
.cuts{list-style:none;padding:0;margin:0}
.cuts li{padding:8px 10px;margin:6px 0;border-radius:8px;background:var(--wash)}
.cuts .hint{margin:2px 0 0;font-size:12px}
.cut-title{margin:0!important}
.schedule summary{cursor:pointer;margin:10px 0 2px;padding:6px 0;font-size:13px;list-style:none;display:flex;justify-content:space-between;align-items:center;color:var(--ink)}
.schedule summary::-webkit-details-marker{display:none}
.schedule summary::after{content:"›";color:var(--muted);font-size:18px;line-height:1;transition:transform 150ms}
.schedule[open] summary::after{transform:rotate(90deg)}
.schedule ol{padding-left:20px;margin:4px 0}
.schedule li{font-size:12px;margin:6px 0}
.decision{display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin-top:14px}
.decision .primary{min-height:36px;padding:6px 14px;font-size:14px}
.blocked{margin-top:8px!important}
</style>
