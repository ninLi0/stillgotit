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
function coveredTitles(exam: Exam) { return exam.covered.map((skill) => titles.value.get(skill) ?? "A skill no longer in this course").join(", "); }
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
        <div class="exam-head"><p><strong>{{ examWhen(exam.date, today) }}</strong> <span class="exam-date">· {{ planDay(exam.date) }}</span></p><button type="button" class="quiet remove" :disabled="busy" :aria-label="`Remove the exam on ${planDay(exam.date)}`" @click="emit('remove', exam.date)">Remove</button></div>
        <p class="hint covers">Covers {{ coveredTitles(exam) }}</p>
      </li>
    </ul>
    <p v-else class="hint empty">No exams yet. Add an exam date to plan preparation before it.</p>
    <div class="exam-actions">
      <button type="button" class="small-button" :disabled="busy || (!open && !!addReason)" :aria-expanded="open" :aria-controls="`${id}-form`" :aria-describedby="addReason && !open ? `${id}-reason` : undefined" @click="toggle">{{ open ? 'Close' : 'Add an exam' }}</button>
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
          <label v-for="skill in group.skills" :key="skill.skill" class="check"><input v-model="covered" type="checkbox" :value="skill.skill" :disabled="busy" /> <span>{{ skill.title }}</span></label>
        </fieldset>
      </fieldset>
      <button class="primary" :disabled="busy">Save exam</button>
    </form>
    <div role="alert"><p v-if="error" ref="errorBox" class="error" tabindex="-1">{{ error }}</p></div>
  </section>
</template>
<style scoped>
.exams{margin-top:18px;padding-top:14px;border-top:1px solid var(--line);overflow-wrap:anywhere}
h3{font-size:15px;margin:0 0 6px}
.exam-list{list-style:none;padding:0;margin:0}
.exam-list li{padding:8px 0;border-bottom:1px solid var(--wash)}
.exam-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.exam-head p{margin:0;font-size:13px}
.exam-date{color:var(--muted)}
.remove{font-size:12px;padding:2px 0;flex:none}
.covers{margin:2px 0 0;font-size:12px}
.empty{margin:2px 0 0}
.exam-actions{margin:12px 0 0}
.exam-form{max-width:none;margin-top:6px}
.exam-form label{margin:14px 0 6px;font-size:13px}
.exam-form input[type="date"]{min-height:40px;font-size:14px;margin-top:6px;padding:6px 10px}
fieldset{border:0;padding:0;margin:14px 0 0;min-width:0}
legend{padding:0;font-size:13px;font-weight:600}
.unit-group{margin-top:8px}
.unit-group legend{font-size:12px;font-weight:600;color:var(--muted)}
.check{display:flex;align-items:flex-start;gap:10px;font-size:13px;font-weight:400;margin:8px 0!important}
.check input{width:16px;min-height:16px;margin-top:3px;flex:none;accent-color:var(--primary)}
.exam-form .primary{min-height:36px;padding:6px 14px;font-size:14px;margin-top:16px}
.error{margin-top:12px}
</style>
