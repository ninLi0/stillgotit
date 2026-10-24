<script setup lang="ts">
/**
 * A cited source in a tutor message. Choosing it opens the cited material at the cited place, in a dialog over the
 * conversation. Props: `source`, the citation's material and location. The slot is the citation's text.
 */
import { nextTick, ref } from "vue";
import MaterialMedia from "./MaterialMedia.vue";
import type { StillGotItHttp } from "../../generated/wire.ts";

type Citation = StillGotItHttp["/learning/read"]["output"]["data"]["sessions"][number]["citations"][number];
defineProps<{ source: Citation }>();
const open = ref(false), dialog = ref<HTMLDialogElement | null>(null);
async function show() { open.value = true; await nextTick(); dialog.value?.showModal(); }
</script>

<template>
  <button class="source-link" @click="show"><slot /></button>
  <dialog ref="dialog" class="citation-dialog" aria-label="Cited source" @close="open = false"><form method="dialog" class="citation-close"><button class="message-action">Close</button></form><MaterialMedia v-if="open" :material="source.material" :location="source.location" titled /></dialog>
</template>

<style scoped>
.source-link{border:0;background:none;padding:2px 0;color:var(--primary);font-size:12px;text-align:left;text-decoration:underline;text-underline-offset:3px}.citation-dialog{width:min(760px,calc(100vw - 32px));font-size:1rem;max-height:calc(100dvh - 48px);padding:14px 18px 20px;border:1px solid var(--line);border-radius:16px;background:var(--paper);color:var(--ink);box-shadow:0 10px 40px rgba(23,35,64,.25)}.citation-dialog::backdrop{background:rgba(23,35,64,.4)}.citation-close{display:flex;justify-content:flex-end;max-width:none;margin:0 0 4px}
.message-action{border:0;background:transparent;color:var(--muted);padding:5px 0;font-size:12px;text-decoration:underline;text-underline-offset:4px}
</style>
