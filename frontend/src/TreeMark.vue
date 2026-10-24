<script setup lang="ts">
import PixelIcon from "./PixelIcon.vue";

// The brand mark: the pixel leaf. Decorative; the brand name beside it carries the meaning.
withDefaults(defineProps<{ size?: number }>(), { size: 24 });
</script>

<template>
  <PixelIcon name="leaf" :size="size" />
</template>
