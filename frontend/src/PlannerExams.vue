<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";
import { planDay } from "./labels.ts";
import { examWhen, type CourseSkill, type CourseUnit, type Exam, type ExamInput } from "./planning.ts";
// The course's active exams and the form that adds one. The parent sends the requests and owns busy, messages, and focus.
const props = defineProps<{ exams: Exam[]; skills: CourseSkill[]; units: CourseUnit[]; today: string; busy: boolean; addReason: string; error: string }>();
const emit = defineEmits<{ save: [input: ExamInput]; remove: [date: string] }>();
const id = useId();
const open = ref(false), date = ref(""), covered = ref<string[]>([]);
const dateInput = ref<HTMLInputElement | null>(null), errorBox = ref<HTMLElement | null>(null);
const titles = computed(() => new Map(props.skills.map((skill) => [skill.skill, skill.title])));
// Exams record skills. Units only group the choices, in the course's unit order.
const groups = computed(() => {
  const confirmed = props.skills.filter((skill) => skill.status === "CONFIRMED");
  const known = new Set(props.units.map((unit) => unit.unit));
  const grouped = props.units.map((unit) => ({ key: unit.unit, title: unit.title, skills: confirmed.filter((skill) => skill.unit === unit.unit) }));
  grouped.push({ key: "", title: "Other skills", skills: confirmed.filter((skill) => !known.has(skill.unit)) });
  return grouped.filter((group) => group.skills.length);
});
const sameDate = computed(() => props.exams.some((exam) => exam.date === date.value));
function coveredTitles(exam: Exam) { return exam.covered.map((skill) => titles.value.get(skill) ?? "A skill no longer in this course"); }
async function toggle() {
  open.value = !open.value;
  if (open.value) { await nextTick(); dateInput.value?.focus(); }
}
function submit() { emit("save", { date: date.value, covered: [...covered.value] }); }
/** Closes and clears the form after the exam is saved. */
function close() { open.value = false; date.value = ""; covered.value = []; }
defineExpose({ close, alertBox: () => errorBox.value });
</script>
<template>
  <section class="exams" :aria-labelledby="`${id}-title`">
    <h3 :id="`${id}-title`">Exams</h3>
    <ul v-if="exams.length" class="exam-list">
      <li v-for="exam in exams" :key="exam.exam">
        <div class="exam-head"><p><strong>{{ examWhen(exam.date, today) }} · {{ planDay(exam.date) }}</strong></p><button type="button" class="quiet remove" :disabled="busy" :aria-label="`Remove the exam on ${planDay(exam.date)}`" @click="emit('remove', exam.date)">Remove</button></div>
        <p class="sr-only">Covers {{ coveredTitles(exam).join(', ') }}</p>
        <ul class="skill-chips" aria-hidden="true"><li v-for="(title, index) in coveredTitles(exam)" :key="index">{{ title }}</li></ul>
      </li>
    </ul>
    <p v-else class="hint empty">No exams yet. Add an exam date to plan preparation before it.</p>
    <div class="exam-actions">
      <button type="button" class="secondary ocean add-exam" :disabled="busy || (!open && !!addReason)" :aria-expanded="open" :aria-controls="`${id}-form`" :aria-describedby="addReason && !open ? `${id}-reason` : undefined" @click="toggle">{{ open ? 'Close' : '+ Add an exam' }}</button>
      <p v-if="addReason && !open" :id="`${id}-reason`" class="hint reason">{{ addReason }}</p>
    </div>
    <form v-if="open" :id="`${id}-form`" class="exam-form" novalidate @submit.prevent="submit">
      <label>Exam date<input ref="dateInput" v-model="date" type="date" :min="today" :disabled="busy" /></label>
      <p v-if="sameDate" class="hint">An exam on this date is already listed. Saving replaces the skills it covers.</p>
      <fieldset class="skill-choice">
        <legend>Skills it covers</legend>
        <p v-if="!groups.length" class="hint">Confirm a skill first. An exam covers confirmed skills.</p>
        <fieldset v-for="group in groups" :key="group.key" class="unit-group">
          <legend>{{ group.title }}</legend>
          <label v-for="skill in group.skills" :key="skill.skill" class="check"><input v-model="covered" type="checkbox" :value="skill.skill" :disabled="busy" /><span class="box" aria-hidden="true" /><span>{{ skill.title }}</span></label>
        </fieldset>
      </fieldset>
      <button class="primary ocean" :disabled="busy">Save exam</button>
    </form>
    <div role="alert"><p v-if="error" ref="errorBox" class="error" tabindex="-1">{{ error }}</p></div>
  </section>
</template>
<style scoped>
.exams{background:#FFFFFF;border:1px solid var(--line);border-radius:18px;padding:20px 22px;overflow-wrap:anywhere;min-width:0}
h3{margin:0 0 6px;font-family:var(--font-display);font-weight:400;font-size:21px}
.exam-list{list-style:none;padding:0;margin:0}
.exam-list li{padding:12px 0;border-top:1px solid var(--inset)}
.exam-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.exam-head p{margin:0;font-size:14px}
.remove{font-size:12px;padding:2px 0;flex:none;color:var(--muted)}
.skill-chips{list-style:none;display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0;padding:0}
.skill-chips li{padding:2px 10px;border-radius:999px;background:var(--inset);font-size:12px;max-width:100%}
.empty{margin:2px 0 0;font-size:13px}
.exam-actions{margin:10px 0 0}
.add-exam{min-height:36px;padding:0 14px;font-size:13px;white-space:nowrap}
.exam-form{max-width:none;margin-top:10px;padding:14px;border-radius:14px;background:var(--inset)}
.exam-form label{margin:0 0 6px;font-size:13px;font-weight:700}
.exam-form input[type="date"]{min-height:40px;font-size:14px;margin-top:6px;padding:6px 10px;border-radius:10px}
fieldset{border:0;padding:0;margin:14px 0 0;min-width:0}
legend{padding:0;font-size:13px;font-weight:700}
.unit-group{margin-top:8px}
.unit-group legend{font-family:var(--font-display);font-weight:400;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--faint)}
.check{position:relative;display:flex;align-items:flex-start;gap:10px;font-size:13px!important;font-weight:400!important;margin:8px 0!important;cursor:pointer}
.check input{position:absolute;opacity:0;width:18px;height:18px;min-height:0;margin:0;left:0}
.check .box{width:18px;height:18px;flex:none;border-radius:5px;border:1.5px solid #BDBDB8;background:#FFFFFF;display:grid;place-items:center}
.check input:checked+.box{background:var(--ocean-edge);border-color:var(--ocean-edge)}
.check input:checked+.box::after{content:"✓";color:#FFFFFF;font-size:12px;font-weight:800;line-height:1}
.check input:focus-visible+.box{outline:2px solid var(--ink);outline-offset:2px}
.exam-form .primary{min-height:40px;padding:0 16px;font-size:14px;margin-top:16px}
.error{margin-top:12px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
</style>
