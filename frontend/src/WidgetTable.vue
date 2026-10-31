<script setup lang="ts">
import type { TableWidget } from "../../src/answer-widgets.ts";

// A table example: a header row and at most eight rows of short cells. The example's title names the table for screen
// readers (`labelledby`). On a narrow screen the table scrolls sideways inside its own frame, which the keyboard can
// reach and scroll, so the page itself never scrolls sideways.
defineProps<{ widget: TableWidget; labelledby: string }>();
const isNumber = (cell: string | number) => typeof cell === "number";
const shown = (cell: string | number) => typeof cell === "number" ? String(cell).replace(/^-/, "−") : cell;
</script>

<template>
  <div class="table-frame" tabindex="0" role="region" :aria-labelledby="labelledby">
    <table :aria-labelledby="labelledby">
      <thead><tr><th v-for="(column, index) in widget.columns" :key="index" scope="col">{{ column }}</th></tr></thead>
      <tbody>
        <tr v-for="(row, rowIndex) in widget.rows" :key="rowIndex">
          <td v-for="(cell, index) in row" :key="index" :class="{ number: isNumber(cell), empty: cell === '' }">
            <template v-if="cell === ''"><span aria-hidden="true">–</span><span class="sr-only">empty</span></template><template v-else>{{ shown(cell) }}</template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table-frame{max-width:100%;overflow-x:auto;border-radius:10px;box-shadow:0 0 0 1px var(--lesson-chip-line);background:var(--card)}
.table-frame:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
table{width:100%;border-collapse:collapse;font-size:14px;line-height:1.5}
th,td{min-width:4em;max-width:16em;padding:7px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
th{background:var(--dawn-soft);color:var(--dawn-soft-text);font-size:13px;font-weight:700}
tbody tr:last-child td{border-bottom:0}
td.number{text-align:right;font-variant-numeric:tabular-nums}
td.empty{color:var(--muted)}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
</style>
