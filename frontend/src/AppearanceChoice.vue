<script setup lang="ts">
import { useId } from "vue";
import PixelIcon from "./PixelIcon.vue";
import { chooseTheme, themeChoice, type ThemeChoice } from "./theme.ts";

// The Appearance row in Settings: System, Light or Dark, as tiles in the same style as the Home view choice. Choosing
// applies at once and is kept in this browser, not on the server (theme.ts). Each tile previews its theme with the
// day or night sky, whatever theme the page is in.
const OPTIONS: { value: ThemeChoice; name: string }[] = [{ value: "system", name: "System" }, { value: "light", name: "Light" }, { value: "dark", name: "Dark" }];
// A crescent moon in the pixel palette's pale yellow, 12×12 like the other icons.
const MOON = ["............", "...lll......", "..lll.......", ".llll.......", ".llll.......", ".llll.......", ".lllll......", ".llllll.....", ".llllllllll.", "..llllllll..", "...llllll...", "............"];
const noteId = `${useId()}-note`;
</script>

<template>
  <h3 class="eyebrow">Appearance</h3>
  <div class="theme-tiles" role="radiogroup" aria-label="Appearance" :aria-describedby="noteId">
    <button v-for="option in OPTIONS" :key="option.value" type="button" role="radio" class="theme-tile" :aria-checked="themeChoice === option.value" @click="chooseTheme(option.value)">
      <span class="theme-preview" :class="option.value" aria-hidden="true">
        <span v-if="option.value !== 'dark'" class="sky day"><PixelIcon name="sun" :size="36" /></span>
        <span v-if="option.value !== 'light'" class="sky night"><PixelIcon :rows="MOON" :size="36" /></span>
      </span>
      <span class="tile-name">{{ option.name }}</span>
    </button>
  </div>
  <p :id="noteId" class="theme-note">System follows your device.</p>
</template>

<style scoped>
/* The tiles match the Home view tiles in App.vue. */
h3 { margin: 0 0 10px; }
.theme-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.theme-tile { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 0; border-radius: 16px; background: var(--card); box-shadow: 0 0 0 1px var(--ring); color: var(--ink); text-align: left; }
.theme-tile[aria-checked="true"] { box-shadow: 0 0 0 2px var(--meadow-edge); background: var(--meadow-soft); }
.theme-preview { display: flex; height: 64px; overflow: hidden; border-radius: 12px; box-shadow: inset 0 0 0 1px var(--line); }
.sky { display: flex; flex: 1; align-items: center; justify-content: center; }
.sky.day { background: var(--preview-day); }
.sky.night { background: var(--preview-night); }
.tile-name { font-size: 14px; font-weight: 700; }
.theme-note { margin: 10px 0 0; font-size: 13px; color: var(--muted); }
@media (max-width: 520px) { .theme-tiles { gap: 8px; } .theme-tile { padding: 8px; } .sky :deep(.pixel-icon) { width: 28px; height: 28px; } }
</style>
