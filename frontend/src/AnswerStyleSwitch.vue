<script setup lang="ts">
import { onMounted, ref, useId } from "vue";
import { api, failureText } from "./api.ts";

// The "Interactive examples" switch in the Tutor section of Settings (design/compositions/Settings.md, "Interactive
// examples"). The answer style lives on the server, so it follows the learner to every device. The switch reads it when
// it mounts and each time Settings opens (`refresh`), and saves as soon as it changes. Replies can arrive out of order,
// so only the latest request's reply is shown. After a failure the switch returns to the saved style and says why.
type Style = "plain" | "interactive";
const id = useId();
const saved = ref<Style | null>(null), on = ref(false), working = ref(false), note = ref(""), problem = ref("");
let latest = 0;

async function refresh() {
  const ticket = ++latest;
  note.value = ""; problem.value = "";
  try {
    const result = await api.settings.answers({});
    if (ticket !== latest) return;
    if ("error" in result) { problem.value = failureText(result); return; }
    saved.value = result.style as Style; on.value = result.style === "interactive";
  } catch {
    if (ticket === latest) problem.value = failureText({ error: "NETWORK_ERROR" });
  }
}

async function change(event: Event) {
  const style: Style = (event.target as HTMLInputElement).checked ? "interactive" : "plain";
  const ticket = ++latest;
  on.value = style === "interactive"; working.value = true; note.value = ""; problem.value = "";
  try {
    const result = await api.settings.answers.set({ style });
    if (ticket !== latest) return;
    if ("error" in result) { problem.value = failureText(result); on.value = saved.value === "interactive"; return; }
    saved.value = result.style as Style; on.value = result.style === "interactive";
    note.value = result.style === "interactive" ? "Saved. Your next lesson answers may include an interactive example." : "Saved. Your next lesson answers will be plain text.";
  } catch {
    if (ticket !== latest) return;
    problem.value = failureText({ error: "NETWORK_ERROR" }); on.value = saved.value === "interactive";
  } finally {
    if (ticket === latest) working.value = false;
  }
}

// While a change is saving, the switch keeps its focus but does not change again, so two saves never cross.
function hold(event: MouseEvent) { if (working.value) event.preventDefault(); }

onMounted(refresh);
defineExpose({ refresh });
</script>

<template>
  <div class="examples-setting">
    <div class="switch-row">
      <label :for="id" class="switch-label">Interactive examples</label>
      <input :id="id" type="checkbox" role="switch" class="switch" :checked="on" :disabled="saved === null" :aria-busy="working" :aria-describedby="`${id}-about`" @click="hold" @change="change" />
    </div>
    <p :id="`${id}-about`" class="switch-about">When this is on, the tutor may add one interactive example to a lesson answer, such as a slider, a table, steps, or a quick question, and each example is the tutor's own illustration of a passage in your materials, not a citation of it.</p>
    <div role="status"><p v-if="note" class="notice">{{ note }}</p></div>
    <div role="alert"><p v-if="problem" class="error">{{ problem }}</p></div>
  </div>
</template>

<style scoped>
.examples-setting{margin-top:22px;padding-top:16px;border-top:1px solid var(--line)}
.switch-row{display:flex;align-items:center;justify-content:space-between;gap:16px}
.switch-label{margin:0;font-size:14px;font-weight:600;cursor:pointer}
/* A native checkbox drawn as a switch. Off, a grey knob sits left on a pale track; on, a knob in the card's color sits
   right on a green track. The track's edge keeps at least 3:1 against the card (3.38:1 light, 5.11:1 dark) and the knob against its track
   (off 5.41:1 and 5.14:1, on 5.17:1 and 8.12:1). */
.switch{appearance:none;-webkit-appearance:none;position:relative;flex:none;width:46px;height:26px;min-height:0;margin:0;padding:0;border:1px solid var(--check-line);border-radius:999px;background:var(--inset-3);cursor:pointer;transition:background-color var(--dur-quick) var(--ease-enter),border-color var(--dur-quick) var(--ease-enter)}
.switch::before{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:var(--muted);transition:transform var(--dur-move) var(--ease-move),background-color var(--dur-quick) var(--ease-enter)}
.switch:checked{background:var(--strong);border-color:var(--strong)}
.switch:checked::before{transform:translateX(20px);background:var(--card)}
.switch:focus-visible{outline:2px solid var(--focus);outline-offset:3px;box-shadow:none;border-color:var(--check-line)}
.switch:checked:focus-visible{border-color:var(--strong)}
.switch:disabled{cursor:not-allowed;opacity:.55}
.switch-about{margin:8px 0 0;font-size:13px;line-height:1.5;color:var(--muted)}
.examples-setting .notice,.examples-setting .error{margin:10px 0 0}
</style>
