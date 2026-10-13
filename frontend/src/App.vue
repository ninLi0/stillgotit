<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, errorMessage, type Course } from "./api.ts";
import TreeMark from "./TreeMark.vue";

const loading = ref(true), busy = ref(false), choosing = ref(false), canResume = ref(false);
const username = ref<string | null>(null), chosenName = ref("");
const courses = ref<Course[]>([]), title = ref("MIT 18.06SC Linear Algebra");
const error = ref(""), notice = ref("");
const PENDING = "stillgotit-sign-in-pending";

async function loadAccount() {
  const me = await api.auth.me({});
  if ("error" in me) {
    if (me.error !== "UNAUTHORIZED") error.value = errorMessage(me.error);
    username.value = null;
    courses.value = [];
    return false;
  }
  username.value = me.username;
  const result = await api.courses({});
  if ("error" in result) { error.value = errorMessage(result.error); return true; }
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
      error.value = errorMessage(result.error);
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
  if ("error" in result) { error.value = errorMessage(result.error); busy.value = false; return; }
  sessionStorage.setItem(PENDING, "1");
  window.location.assign(result.address);
}

async function createCourse() {
  busy.value = true; error.value = ""; notice.value = "";
  const result = await api.courses.create({ title: title.value.trim() });
  if ("error" in result) {
    error.value = result.error === "CONFLICT" ? "You already have a course. Your saved course is shown below." : errorMessage(result.error);
    if (result.error === "CONFLICT" || result.error === "UNAUTHORIZED") await loadAccount();
  } else {
    await loadAccount();
    notice.value = "Course saved.";
  }
  busy.value = false;
}

async function signOut() {
  busy.value = true; error.value = "";
  const result = await api.auth.logout({});
  if ("error" in result && result.error !== "UNAUTHORIZED") error.value = errorMessage(result.error);
  else { username.value = null; courses.value = []; notice.value = ""; }
  busy.value = false;
}

async function reload() { busy.value = true; error.value = ""; await loadAccount(); busy.value = false; }

onMounted(async () => {
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
  <div class="shell">
    <header class="header">
      <a class="wordmark" href="/" aria-label="StillGotIt home"><span class="mark" aria-hidden="true">✳</span> StillGotIt</a>
      <div v-if="username" class="account"><span>{{ username }}</span><button class="quiet" :disabled="busy" @click="signOut">Sign out</button></div>
      <span v-else class="header-note">Keep what you learn.</span>
    </header>

    <main :aria-busy="loading || busy">
      <p v-if="loading" class="loading" role="status">Opening your study space…</p>
      <div v-else class="workspace">
        <section class="task" aria-labelledby="page-title">
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

          <template v-else-if="courses.length === 0">
            <p class="context">Your first course</p>
            <h1 id="page-title">Give your learning<br />a place to grow.</h1>
            <p class="intro">Start with one course. Choose a name you will recognize when you return.</p>
            <form @submit.prevent="createCourse">
              <label for="course-title">Course name</label>
              <input id="course-title" v-model="title" required maxlength="160" autocomplete="off" :disabled="busy" aria-describedby="course-hint" />
              <p id="course-hint" class="hint">For example, MIT 18.06SC Linear Algebra.</p>
              <button class="primary" :disabled="busy || !title.trim()">{{ busy ? 'Saving…' : 'Create course' }}</button>
            </form>
          </template>

          <template v-else>
            <p class="context">Your course</p>
            <h1 id="page-title" class="course-title">{{ courses[0]!.title }}</h1>
            <div class="saved-state"><span class="saved-dot" aria-hidden="true"></span> Saved to your study space</div>
            <p class="intro">Your course is ready. Its skills will appear here as you add learning material.</p>
            <div class="empty-state"><span class="empty-count">0</span><div><strong>Skills added</strong><p>No skills or mastery estimates yet.</p></div></div>
            <button class="quiet" :disabled="busy" @click="reload">Refresh saved course</button>
          </template>

          <div v-if="error" class="error" role="alert"><p>{{ error }}</p><button v-if="username" class="quiet" :disabled="busy" @click="reload">Reload saved work</button></div>
          <p v-if="notice" class="notice" role="status">{{ notice }}</p>
        </section>

        <figure class="tree-panel">
          <div class="tree-drawing"><TreeMark /></div>
          <figcaption>{{ username && courses.length ? 'Room for your next skill.' : 'Understanding takes root.' }}</figcaption>
        </figure>
      </div>
    </main>
    <footer>StillGotIt <span>Learn. Practice. Return.</span></footer>
  </div>
</template>
