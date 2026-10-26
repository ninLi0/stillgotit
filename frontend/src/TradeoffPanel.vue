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
// The headline names the shortfall when the exam needs more time than the days before it hold.
const headline = computed(() => {
  const short = Math.round(props.proposal.estimatedExamMinutes - props.proposal.availableExamMinutes);
  const day = planDay(props.proposal.focusExamDate).split(",")[0];
  return short > 0 ? `Exam prep needs ${short} more ${short === 1 ? "minute" : "minutes"} than you have before ${examDay.value ? "the exam" : day}.` : "Review the proposed plan.";
});
</script>
<template>
  <section class="tradeoffs" :aria-labelledby="`${id}-title`">
    <div class="proposal-body">
      <p class="eyebrow proposal-eyebrow">Your plan needs a decision</p>
      <h3 :id="`${id}-title`">{{ headline }}</h3>
      <p class="sentence">{{ proposal.explanation }} Nothing changes until you confirm.</p>
      <ul v-if="cuts.length" class="defer-chips" aria-label="What would be left out">
        <li v-for="row in cuts" :key="`${row.cut.deadline}:${row.cut.candidateKey}`">Defer · {{ row.label }} · {{ minutes(row.cut.minutes) }}</li>
      </ul>
      <details class="schedule">
        <summary>What changes</summary>
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
            <li v-for="row in cuts" :key="`${row.cut.deadline}:${row.cut.candidateKey}`"><p class="cut-title"><strong>{{ row.label }}</strong> · {{ minutes(row.cut.minutes) }}</p><p>{{ row.cut.reason }}</p><p class="hint">{{ row.cut.consequence }}</p></li>
          </ul>
        </template>
        <template v-if="items.length">
          <h4>What the plan would schedule ({{ items.length }})</h4>
          <ol class="scheduled"><li v-for="row in items" :key="row.item">{{ planDayLabel(row.day, today) }} · {{ row.candidate.activity }} · {{ row.candidate.minutes }} min<template v-if="row.candidate.deadlineRefs.length"> · exam preparation</template></li></ol>
        </template>
        <p v-else class="hint">The proposed plan schedules no activities.</p>
        <p v-if="examDay" class="hint">This preparation was not finished before the exam. Routine updates for this course wait until you confirm.</p>
        <p class="hint">{{ hasActivePlan ? 'Your current plan stays in use until you confirm.' : 'No plan starts until you confirm.' }}</p>
      </details>
    </div>
    <div class="decision">
      <button class="primary ocean" :disabled="busy || !!blocked" :aria-describedby="blocked ? `${id}-blocked` : undefined" @click="emit('confirm')">Confirm changes</button>
      <button class="keep" :disabled="busy" @click="emit('decline')">Keep current plan</button>
      <p v-if="blocked" :id="`${id}-blocked`" class="hint blocked">{{ blocked }}</p>
    </div>
  </section>
</template>
<style scoped>
.tradeoffs{margin-top:22px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center;background:var(--ocean-wash);border:1px solid var(--ocean-line);border-radius:24px;padding:20px 24px;box-shadow:0 10px 28px rgb(var(--shadow) / .07);overflow-wrap:anywhere;animation:sgRise var(--dur-enter) var(--ease-enter) both}
.proposal-body{min-width:0}
.proposal-eyebrow{margin:0 0 4px;font-size:12px;color:var(--ocean-eyebrow)}
h3{margin:0 0 6px;font-family:var(--font-display);font-weight:400;font-size:24px;line-height:1.25}
.sentence{margin:0 0 10px;font-size:14px;color:var(--muted);line-height:1.5}
.defer-chips{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0}
.defer-chips li{padding:5px 12px;border-radius:10px;border:1px dashed var(--line-strong);font-size:13px;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
h4{font-size:13px;margin:12px 0 4px}
.schedule{margin-top:10px;font-size:13px}
.schedule summary{cursor:pointer;display:inline-block;color:var(--ocean-soft-text);font-weight:700;text-decoration:underline;text-underline-offset:4px;list-style:none}
.schedule summary::-webkit-details-marker{display:none}
.schedule p{margin:4px 0}
.facts{margin:10px 0 0}
.facts div{display:flex;flex-wrap:wrap;gap:0 6px;padding:5px 0;border-top:1px solid var(--ocean-rule)}
.facts dt{color:var(--muted)}
.facts dt::after{content:":"}
.facts dd{margin:0;font-weight:700}
.cuts{list-style:none;padding:0;margin:0}
.cuts li{padding:8px 10px;margin:6px 0;border-radius:10px;background:var(--card)}
.cuts .hint{margin:2px 0 0;font-size:12px}
.cut-title{margin:0!important}
.scheduled{padding-left:20px;margin:4px 0}
.scheduled li{font-size:12px;margin:6px 0}
.decision{display:flex;flex-direction:column;gap:8px;min-width:190px}
.decision .primary{min-height:44px;padding:0 20px;font-size:14px}
.keep{border:1px solid var(--line);border-radius:12px;background:var(--card);min-height:44px;padding:0 20px;font-size:14px;font-weight:700;white-space:nowrap;color:var(--ink)}
.keep:hover:not(:disabled){border-color:var(--line-strong)}
.blocked{margin:0;font-size:12px;max-width:220px}
@media(max-width:760px){.tradeoffs{grid-template-columns:1fr;padding:18px}.decision{flex-direction:row;flex-wrap:wrap;min-width:0}}
</style>
