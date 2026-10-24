<script setup lang="ts">
/**
 * The result of a control's last request, shown beside the control: a success notice in a status region, or the
 * refusal in an alert. `id` names the messages (`<id>-ok`, `<id>-error`) so focus can move to them after a save.
 */
defineProps<{ id: string; note?: { ok?: string; error?: string } }>();
</script>

<template>
  <div role="status"><p v-if="note?.ok" :id="`${id}-ok`" class="notice" tabindex="-1">{{ note.ok }}</p></div>
  <div role="alert"><p v-if="note?.error" :id="`${id}-error`" class="error" tabindex="-1">{{ note.error }}</p></div>
</template>

<style scoped>
.notice{margin:10px 0 0;font-size:13px;line-height:1.5}.error{margin:10px 0 0;padding:10px 12px;font-size:13px;line-height:1.5}
</style>
