<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { api, failureText, type Course } from "./api.ts";
import PixelIcon from "./PixelIcon.vue";
import CourseWorkspace from "./CourseWorkspace.vue";
import TutorPanel from "./TutorPanel.vue";
import { levelName, modelName, tutorSettings } from "./tutor-choice.ts";
import { HOME_VIEW_KEY, type HomeView } from "./revamp-types.ts";

// The Home view preference (tree or tasks) lives on the server (design/compositions/Settings.md, "The home view"), so it
// follows the learner between devices. This device remembers the last answer so the first paint does not flash.
function loadHomeView(): HomeView { try { return localStorage.getItem(HOME_VIEW_KEY) === "tasks" ? "tasks" : "tree"; } catch { return "tree"; } }
function rememberHomeView(view: HomeView) { homeView.value = view; try { localStorage.setItem(HOME_VIEW_KEY, view); } catch { /* The choice applies until reload. */ } }
const homeView = ref<HomeView>(loadHomeView()), viewNote = ref("");
async function fetchHomeView() {
  const result = await api.settings.view({});
  if (!("error" in result)) rememberHomeView(result.view);
}
async function saveHomeView(next: HomeView) {
  rememberHomeView(next); viewNote.value = "";
  const result = await api.settings.view.set({ view: next });
  if ("error" in result) viewNote.value = `${failureText(result)} This device keeps your choice until then.`;
}

const loading = ref(true), busy = ref(false), choosing = ref(false), canResume = ref(false);
const username = ref<string | null>(null), chosenName = ref("");
// The course name starts empty. A prefilled example merged with typed text and saved a doubled name.
const courses = ref<Course[]>([]), title = ref("");
const error = ref(""), notice = ref("");
const PENDING = "stillgotit-sign-in-pending", SELECTED = "stillgotit-selected-course";
// The last chosen course survives reloads. Storage can be blocked, so a failed read falls back to the first course.
const chosenCourse = ref(readChoice()), creating = ref(false), menuOpen = ref(false), switcher = ref<HTMLElement | null>(null);
const selected = computed(() => courses.value.find((c) => c.course === chosenCourse.value) ?? courses.value[0]);
const inCourse = computed(() => !!username.value && !!selected.value && !creating.value);

function readChoice() { try { return localStorage.getItem(SELECTED) ?? ""; } catch { return ""; } }
function selectCourse(course: string) {
  chosenCourse.value = course; creating.value = false; menuOpen.value = false; error.value = ""; notice.value = "";
  try { localStorage.setItem(SELECTED, course); } catch { /* The choice still applies until reload. */ }
}
async function startCourse() {
  menuOpen.value = false; creating.value = true; title.value = ""; error.value = ""; notice.value = "";
  await nextTick(); document.getElementById("course-title")?.focus();
}
function closeMenu(refocus = false) {
  if (!menuOpen.value) return;
  menuOpen.value = false;
  if (refocus) switcher.value?.querySelector<HTMLElement>(".switch")?.focus();
}
function outside(event: PointerEvent) { if (!switcher.value?.contains(event.target as Node)) closeMenu(); }

async function loadAccount() {
  const me = await api.auth.me({});
  if ("error" in me) {
    if (me.error !== "UNAUTHORIZED") error.value = failureText(me);
    username.value = null;
    courses.value = [];
    return false;
  }
  username.value = me.username;
  const [result] = await Promise.all([api.courses({}), fetchHomeView()]);
  if ("error" in result) { error.value = failureText(result); return true; }
  courses.value = result.courses;
  return true;
}

async function resume() {
  busy.value = true; error.value = "";
  const result = choosing.value
    ? await api.auth.commons.choose({ username: chosenName.value.trim() })
    : await api.auth.commons.resume({});
  if ("error" in result) {
    if (result.error === "CONFLICT" || result.error === "INVALID_REQUEST") {
      choosing.value = true;
      error.value = "Choose an available username. Use 3–32 letters, digits, underscores, or hyphens.";
    } else {
      error.value = failureText(result);
      canResume.value = result.error !== "FORBIDDEN";
      if (!canResume.value) sessionStorage.removeItem(PENDING);
    }
  } else {
    sessionStorage.removeItem(PENDING);
    choosing.value = false; canResume.value = false;
    await loadAccount();
  }
  busy.value = false;
}

async function signIn() {
  busy.value = true; error.value = "";
  const result = await api.auth.commons.start({});
  if ("error" in result) { error.value = failureText(result); busy.value = false; return; }
  sessionStorage.setItem(PENDING, "1");
  window.location.assign(result.address);
}

async function createCourse() {
  busy.value = true; error.value = ""; notice.value = "";
  const result = await api.courses.create({ title: title.value.trim() });
  if ("error" in result) {
    error.value = failureText(result);
    if (result.error === "UNAUTHORIZED") await loadAccount();
  } else {
    await loadAccount();
    selectCourse(result.course);
    notice.value = "Course saved.";
  }
  busy.value = false;
  // The form is gone once the course opens. Move focus to the new page's heading instead of losing it.
  await nextTick(); document.getElementById("home-title")?.focus();
}

const settingsDialog = ref<HTMLDialogElement | null>(null);
// The header names the choice in the latest tutor settings record the page received. It reads only "Tutor" until one arrives.
const tutorPanel = ref<InstanceType<typeof TutorPanel> | null>(null);
const tutorChoice = computed(() => {
  const record = tutorSettings.value;
  if (!record) return "";
  return record.status === "RETIRED" ? "Tutor: choose again" : `${modelName(record.choice.model, record)} · ${levelName(record.choice.level)}`;
});
// The tutor row opens Settings at its Tutor section.
async function openSettings(atTutor = false) {
  settingsDialog.value?.showModal();
  if (atTutor) { await nextTick(); await tutorPanel.value?.open(); }
}
async function signOut() {
  busy.value = true; error.value = "";
  const result = await api.auth.logout({});
  if ("error" in result && result.error !== "UNAUTHORIZED") error.value = failureText(result);
  else { username.value = null; courses.value = []; notice.value = ""; creating.value = false; menuOpen.value = false; }
  busy.value = false;
}

async function reload() { busy.value = true; error.value = ""; await loadAccount(); busy.value = false; }

onBeforeUnmount(() => document.removeEventListener("pointerdown", outside));
onMounted(async () => {
  document.addEventListener("pointerdown", outside);
  const callback = window.location.pathname === "/auth/commons/callback";
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code"), state = params.get("state");
  if (callback) window.history.replaceState(null, "", "/");
  if (callback && code && state) {
    sessionStorage.setItem(PENDING, "1");
    const result = await api.auth.commons.finish({ code, state });
    if (!("error" in result)) chosenName.value = result.username;
    // A lost confirmation reply may still have saved the identity. Never repost the code.
    await resume();
  } else {
    const signedIn = await loadAccount();
    if (!signedIn && sessionStorage.getItem(PENDING) === "1") await resume();
    else if (callback && !signedIn) error.value = "Sign-in was not completed. Try again with Commons.";
  }
  loading.value = false;
});
</script>

<template>
  <p v-if="loading" class="loading boot" role="status">Opening your study space…</p>
  <template v-else-if="inCourse">
    <CourseWorkspace :key="selected!.course" :course="selected!" :username="username!" :tutor-choice="tutorChoice" :home-view="homeView"
      @update:home-view="saveHomeView" @settings="openSettings()" @tutor="openSettings(true)">
      <template #switcher>
        <div ref="switcher" class="switcher" @keydown.esc="closeMenu(true)">
          <button class="switch card" type="button" :aria-expanded="menuOpen" aria-controls="course-menu" :disabled="busy" @click="menuOpen = !menuOpen">
            <span class="switch-text"><span class="eyebrow">Course</span><span class="switch-title">{{ selected!.title }}</span></span><svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" /></svg>
          </button>
          <div v-if="menuOpen" id="course-menu" class="menu">
            <p class="menu-heading eyebrow">Courses</p>
            <button v-for="c in courses" :key="c.course" type="button" class="row" :class="{ current: c.course === selected!.course && !creating }" :aria-current="c.course === selected!.course && !creating ? 'true' : undefined" @click="selectCourse(c.course)">{{ c.title }}</button>
            <button type="button" class="row" @click="startCourse">+ New course</button>
          </div>
        </div>
      </template>
    </CourseWorkspace>
    <div v-if="error" class="error floating-error" role="alert"><p>{{ error }}</p><button class="quiet" :disabled="busy" @click="reload">Reload saved work</button></div>
  </template>
  <div v-else class="welcome" :aria-busy="busy">
    <main class="welcome-main">
      <section class="welcome-text" aria-labelledby="page-title">
        <div class="brand"><PixelIcon name="leaf" :size="24" /><span class="brand-name">StillGotIt</span></div>
        <template v-if="!username && !choosing">
          <p class="eyebrow">Your study space</p>
          <h1 id="page-title" class="display hero-title">A place for what you learn.</h1>
          <p class="intro">Turn your course materials into skills, practise them with a tutor that teaches from your own files, and review before you forget.</p>
          <button class="primary meadow" :disabled="busy" @click="signIn">{{ busy ? 'Connecting…' : 'Sign in with Commons' }}</button>
          <p class="hint">Use your 6.1040 class account.</p>
          <button v-if="canResume" class="quiet retry" :disabled="busy" @click="resume">Resume sign-in</button>
          <ol class="steps">
            <li><PixelIcon name="school" :size="24" /><span><strong>Bring your files</strong>Lectures, notes and problem sets.</span></li>
            <li><PixelIcon name="leaf" :size="24" /><span><strong>Grow skills</strong>Learn each one with your tutor.</span></li>
            <li><PixelIcon name="calendar" :size="24" /><span><strong>Review in time</strong>A few minutes a day.</span></li>
          </ol>
        </template>
        <template v-else-if="!username && choosing">
          <p class="eyebrow">One last step</p>
          <h1 id="page-title" class="display hero-title small">Choose your username.</h1>
          <p class="intro">Your Commons account is confirmed. Choose a name for this study space.</p>
          <form @submit.prevent="resume">
            <label for="username">Username</label>
            <input id="username" v-model="chosenName" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]{3,32}" autocomplete="username" :disabled="busy" />
            <button class="primary meadow" :disabled="busy">{{ busy ? 'Signing in…' : 'Continue' }}</button>
          </form>
          <button class="quiet retry" :disabled="busy" @click="signIn">Start sign-in again</button>
        </template>
        <template v-else>
          <p class="eyebrow">{{ courses.length ? 'A new course' : 'Your first course' }}</p>
          <h1 id="page-title" class="display hero-title small">Give your learning a place to grow.</h1>
          <p class="intro">{{ courses.length ? 'Each course keeps its own materials and skills.' : 'Start with one course.' }} Choose a name you will recognize when you return.</p>
          <form @submit.prevent="createCourse">
            <label for="course-title">Course name</label>
            <input id="course-title" v-model="title" required maxlength="160" autocomplete="off" :disabled="busy" aria-describedby="course-hint" />
            <p id="course-hint" class="hint">For example, MIT 18.06SC Linear Algebra.</p>
            <span class="create-wrap"><button class="primary meadow" :disabled="busy || !title.trim()" :aria-describedby="title.trim() ? undefined : 'course-reason'">{{ busy ? 'Saving…' : 'Create course' }}</button><p v-if="!title.trim()" id="course-reason" class="hint reason">Enter a course name to continue.</p></span>
          </form>
          <button v-if="courses.length" class="quiet retry" :disabled="busy" @click="selectCourse(selected!.course)">Back to {{ selected!.title }}</button>
          <button class="quiet retry" type="button" :disabled="busy" @click="openSettings()">Settings</button>
        </template>
        <div v-if="error" class="error" role="alert"><p>{{ error }}</p><button v-if="username" class="quiet" :disabled="busy" @click="reload">Reload saved work</button></div>
        <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      </section>
      <figure class="sky-card">
        <PixelIcon name="tree" :size="160" />
        <figcaption class="eyebrow">Understanding takes root</figcaption>
      </figure>
    </main>
  </div>

  <dialog v-if="username" ref="settingsDialog" class="app-settings" aria-labelledby="app-settings-title">
    <h2 id="app-settings-title" class="display">Settings</h2>
    <section class="settings-section">
      <h3 class="eyebrow">Home view</h3>
      <div class="view-tiles" role="radiogroup" aria-label="Home view">
        <button type="button" role="radio" class="view-tile" :aria-checked="homeView === 'tree'" @click="saveHomeView('tree')">
          <span class="tile-preview tree" aria-hidden="true"><PixelIcon name="tree" :size="48" /></span><span class="tile-name">Skill tree</span>
        </button>
        <button type="button" role="radio" class="view-tile" :aria-checked="homeView === 'tasks'" @click="saveHomeView('tasks')">
          <span class="tile-preview tasks" aria-hidden="true"><span v-for="n in 3" :key="n" class="tile-line"><PixelIcon sprite="leaf" :size="14" /><span class="tile-bar" /></span></span><span class="tile-name">Task list</span>
        </button>
      </div>
      <p v-if="viewNote" class="view-note" role="status">{{ viewNote }}</p>
    </section>
    <section class="settings-section"><TutorPanel ref="tutorPanel" inline /></section>
    <section class="settings-section">
      <h3 class="eyebrow">Account</h3>
      <p class="account-line">Signed in as <strong>{{ username }}</strong> with your 6.1040 Commons account.</p>
      <button class="secondary meadow" :disabled="busy" @click="settingsDialog?.close(); signOut()">Sign out</button>
    </section>
    <div class="settings-actions"><button class="primary meadow" @click="settingsDialog?.close()">Close</button></div>
  </dialog>
</template>

<style scoped>
.boot { padding: 40px; }
/* Course switcher card in the sidebar. */
.switcher { position: relative; min-width: 0; }
.switch { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 12px; border: 0; color: var(--ink); text-align: left; }
.switch:hover, .switch[aria-expanded="true"] { background: var(--inset); }
.switch svg { flex: none; color: var(--muted); }
.switch-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.switch-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 650; }
.menu { position: absolute; z-index: 20; top: calc(100% + 6px); left: 0; display: flex; flex-direction: column; gap: 2px; width: 100%; min-width: 220px; max-width: min(360px, calc(100vw - 32px)); max-height: 60vh; overflow-y: auto; padding: 6px; border-radius: 14px; background: #fff; box-shadow: 0 10px 30px rgb(0 0 0 / .12), 0 0 0 1px var(--ring); }
.menu-heading { padding: 6px 10px 4px; }
.row { padding: 8px 10px; border: 0; border-radius: 10px; background: transparent; color: var(--ink); font-size: 14px; text-align: left; overflow-wrap: anywhere; }
.row:hover, .row.current { background: var(--meadow-soft); }
.floating-error { position: fixed; z-index: 50; left: 50%; bottom: 20px; transform: translateX(-50%); width: min(520px, calc(100vw - 32px)); box-shadow: 0 10px 24px rgba(0, 0, 0, .18); }

/* Sign-in and the pages before a course opens. */
.welcome { min-height: 100dvh; padding: 14px; }
.welcome-main { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 40px; min-height: calc(100dvh - 28px); padding: 40px 48px; border: 1px solid var(--card-border); border-radius: 24px; background: #fff; align-items: center; }
.welcome-text { max-width: 520px; display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
.brand { display: flex; align-items: center; gap: 8px; margin-bottom: 28px; }
.brand-name { font: 500 20px var(--font-display); }
.hero-title { margin: 0; font-size: 64px; line-height: 1.05; }
.hero-title.small { font-size: 40px; }
.intro { margin: 0 0 8px; max-width: 440px; color: var(--soft); font-size: 17px; line-height: 1.6; }
.welcome-text .hint { margin: 0; }
.welcome-text form { width: 100%; }
.create-wrap { display: inline-block; margin-top: 18px; }
.create-wrap .primary { margin-top: 0; }
.steps { list-style: none; margin: 24px 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; width: 100%; }
.steps li { display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 14px; background: var(--inset); font-size: 13px; color: var(--muted); }
.steps strong { display: block; color: var(--ink); font-size: 14px; }
.sky-card { margin: 0; align-self: stretch; min-height: 420px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; border-radius: 24px; background: #D7E8F1; }
.sky-card figcaption { color: var(--soft); font-size: 12px; }
@media (max-width: 900px) { .welcome-main { grid-template-columns: minmax(0, 1fr); padding: 28px 22px; } .sky-card { min-height: 260px; } .hero-title { font-size: 48px; } }
@media (max-width: 520px) { .welcome { padding: 8px; } .hero-title { font-size: 40px; } .steps { grid-template-columns: minmax(0, 1fr); } }

/* Settings modal */
.app-settings { border: 0; border-radius: 22px; padding: 24px; width: min(660px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow-y: auto; box-shadow: 0 20px 50px rgba(0, 0, 0, .18); color: var(--ink); background: #fff; }
.app-settings::backdrop { background: rgba(21, 21, 21, .35); }
.app-settings > h2 { margin: 0 0 6px; font-size: 26px; }
.settings-section { padding: 16px 0; border-bottom: 1px solid var(--line); }
.settings-section h3 { margin: 0 0 10px; }
.view-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.view-tile { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 0; border-radius: 16px; background: #fff; box-shadow: 0 0 0 1px var(--ring); text-align: left; }
.view-tile[aria-checked="true"] { box-shadow: 0 0 0 2px var(--meadow-edge); background: var(--meadow-soft); }
.tile-preview { display: flex; align-items: center; justify-content: center; height: 84px; border-radius: 12px; background: #F1F8F2; }
.tile-preview.tasks { flex-direction: column; align-items: stretch; gap: 6px; padding: 10px 14px; background: var(--inset); }
.tile-line { display: flex; align-items: center; gap: 6px; }
.tile-bar { flex: 1; height: 6px; background: var(--ring); }
.tile-name { font-size: 14px; font-weight: 700; }
.view-note { margin: 10px 0 0; font-size: 13px; color: var(--muted); }
.account-line { margin: 0 0 10px; font-size: 14px; color: var(--soft); }
.settings-actions { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
