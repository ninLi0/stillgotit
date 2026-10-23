<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { api, failureText, type Course } from "./api.ts";
import TreeMark from "./TreeMark.vue";
import CourseWorkspace from "./CourseWorkspace.vue";

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
  const result = await api.courses({});
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
  <div class="shell" :class="{ 'app-shell': inCourse }">
    <header class="header">
      <div class="brand">
        <a class="wordmark" href="/" aria-label="StillGotIt home"><span class="mark" aria-hidden="true">✳</span> StillGotIt</a>
        <div v-if="username && selected" ref="switcher" class="switcher" @keydown.esc="closeMenu(true)">
          <button class="switch" type="button" :aria-expanded="menuOpen" aria-controls="course-menu" :disabled="busy" @click="menuOpen = !menuOpen">
            <span class="switch-title">{{ selected.title }}</span><svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <div v-if="menuOpen" id="course-menu" class="menu">
            <p class="menu-heading">Courses</p>
            <button v-for="c in courses" :key="c.course" type="button" class="row" :class="{ current: c.course === selected.course && !creating }" :aria-current="c.course === selected.course && !creating ? 'true' : undefined" @click="selectCourse(c.course)">{{ c.title }}</button>
            <button type="button" class="row" @click="startCourse">+ New course</button>
          </div>
        </div>
      </div>
      <div v-if="username" class="account"><button class="settings-open" aria-haspopup="dialog" @click="settingsDialog?.showModal()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>Settings</button></div>
      <dialog v-if="username" ref="settingsDialog" class="app-settings" aria-labelledby="app-settings-title">
        <h2 id="app-settings-title">Settings</h2>
        <section><h3>Account</h3><p>Signed in as <strong>{{ username }}</strong> with your 6.1040 Commons account.</p><button class="small-button" :disabled="busy" @click="settingsDialog?.close(); signOut()">Sign out</button></section>
        <section><h3>AI tutor</h3><p>Lessons, practice, and feedback come from Google Gemini. Your files and answers are sent to Google to create them.</p></section>
        <div class="settings-actions"><button class="primary" @click="settingsDialog?.close()">Done</button></div>
      </dialog>
      <span v-else class="header-note">Keep what you learn.</span>
    </header>

    <main :class="{ 'course-main': inCourse }" :aria-busy="loading || busy">
      <p v-if="loading" class="loading" role="status">Opening your study space…</p>
      <div v-else class="workspace" :class="{ 'course-mode': inCourse }">
        <section class="task" :aria-labelledby="inCourse ? undefined : 'page-title'">
          <template v-if="!username && !choosing">
            <p class="context">Your study space</p>
            <h1 id="page-title">A place for<br />what you learn.</h1>
            <p class="intro">Build your understanding.<br />Keep your skills within reach.</p>
            <button class="primary" :disabled="busy" @click="signIn">{{ busy ? 'Connecting…' : 'Sign in with Commons' }}</button>
            <p class="hint">Use your 6.1040 class account.</p>
            <button v-if="canResume" class="quiet retry" :disabled="busy" @click="resume">Resume sign-in</button>
          </template>

          <template v-else-if="!username && choosing">
            <p class="context">One last step</p>
            <h1 id="page-title">Choose your<br />username.</h1>
            <p class="intro">Your Commons account is confirmed. Choose a name for this study space.</p>
            <form @submit.prevent="resume">
              <label for="username">Username</label>
              <input id="username" v-model="chosenName" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]{3,32}" autocomplete="username" :disabled="busy" />
              <button class="primary" :disabled="busy">{{ busy ? 'Signing in…' : 'Continue' }}</button>
            </form>
            <button class="quiet retry" :disabled="busy" @click="signIn">Start sign-in again</button>
          </template>

          <template v-else-if="!inCourse">
            <p class="context">{{ courses.length ? 'A new course' : 'Your first course' }}</p>
            <h1 id="page-title">Give your learning<br />a place to grow.</h1>
            <p class="intro">{{ courses.length ? 'Each course keeps its own materials and skills.' : 'Start with one course.' }} Choose a name you will recognize when you return.</p>
            <form @submit.prevent="createCourse">
              <label for="course-title">Course name</label>
              <input id="course-title" v-model="title" required maxlength="160" autocomplete="off" :disabled="busy" aria-describedby="course-hint" />
              <p id="course-hint" class="hint">For example, MIT 18.06SC Linear Algebra.</p>
              <button class="primary" :disabled="busy || !title.trim()" :aria-describedby="title.trim() ? undefined : 'course-reason'">{{ busy ? 'Saving…' : 'Create course' }}</button>
              <p v-if="!title.trim()" id="course-reason" class="hint reason">Enter a course name to continue.</p>
            </form>
            <button v-if="courses.length" class="quiet retry" :disabled="busy" @click="selectCourse(selected!.course)">Back to {{ selected!.title }}</button>
          </template>

          <template v-else>
            <CourseWorkspace :key="selected!.course" :course="selected!" />
          </template>

          <div v-if="error" class="error" role="alert"><p>{{ error }}</p><button v-if="username" class="quiet" :disabled="busy" @click="reload">Reload saved work</button></div>
          <p v-if="notice && !inCourse" class="notice" role="status">{{ notice }}</p>
        </section>

        <figure v-if="!inCourse" class="tree-panel">
          <div class="tree-drawing"><TreeMark /></div>
          <figcaption>Understanding takes root.</figcaption>
        </figure>
      </div>
    </main>
    <footer v-if="!inCourse">StillGotIt <span>Learn. Practice. Return.</span></footer>
  </div>
</template>

<style scoped>
.brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
.switcher { position: relative; min-width: 0; }
.switch { display: flex; align-items: center; gap: 6px; max-width: min(360px, 52vw); padding: 6px 10px; border: 0; border-radius: 10px; background: transparent; color: var(--ink); font-size: 14px; font-weight: 550; }
.switch:hover, .switch[aria-expanded="true"] { background: var(--light); }
.switch svg { flex: none; color: var(--muted); }
.switch-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu { position: absolute; z-index: 20; top: calc(100% + 6px); left: 0; display: flex; flex-direction: column; gap: 2px; width: max-content; min-width: 220px; max-width: min(360px, calc(100vw - 32px)); max-height: 60vh; overflow-y: auto; padding: 6px; border-radius: 14px; background: var(--surface); box-shadow: 0 10px 30px rgb(0 0 0 / .12), 0 0 0 1px var(--line); }
.menu-heading { margin: 0; padding: 6px 10px 4px; color: var(--muted); font-size: 12px; }
.row { padding: 8px 10px; border: 0; border-radius: 10px; background: transparent; color: var(--ink); font-size: 14px; text-align: left; overflow-wrap: anywhere; }
.row:hover, .row.current { background: var(--light); }
.row:focus-visible, .switch:focus-visible { outline-offset: 1px; }
.settings-open{display:flex;align-items:center;gap:7px;border:0;background:transparent;color:var(--muted);font-size:13px;padding:6px 10px;border-radius:10px}.settings-open:hover{background:var(--light);color:var(--ink)}
.app-settings{border:0;border-radius:18px;padding:24px;width:min(420px,calc(100vw - 32px));box-shadow:0 20px 50px rgba(23,35,64,.25);color:var(--ink);background:var(--surface)}.app-settings::backdrop{background:rgba(23,35,64,.35)}.app-settings h2{font:26px Georgia,serif;margin:0 0 6px}.app-settings section{padding:14px 0;border-bottom:1px solid var(--line)}.app-settings h3{font-size:14px;margin:0 0 4px}.app-settings p{font-size:13px;color:var(--muted);margin:0 0 10px}.app-settings .small-button{padding:7px 14px;font-size:13px}.settings-actions{display:flex;justify-content:flex-end;margin-top:16px}.settings-actions .primary{min-height:40px;padding:6px 20px;font-size:14px}
</style>
