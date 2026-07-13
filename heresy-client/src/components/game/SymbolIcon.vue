<template>
  <svg
    class="symbol-icon"
    :class="`symbol-${symbol}`"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <g v-if="symbol === 'sword'" class="symbol-art">
      <path class="symbol-fill" d="M13.5 3.2 20.8 2l-1.2 7.3-7.7 7.7-3.1-3.1 7.7-7.7-3-3Z" />
      <path class="symbol-stroke" d="M13.5 3.2 20.8 2l-1.2 7.3-7.7 7.7-3.1-3.1 7.7-7.7-3-3Z" />
      <path class="symbol-stroke" d="m7.6 12.7 3.7 3.7M5.1 14.9l4 4M3.1 20.9l4.2-4.2" />
      <path class="symbol-spark" d="m17.1 4.7 2.2-.4-.4 2.2" />
    </g>

    <g v-if="symbol === 'shield'" class="symbol-art">
      <path class="symbol-fill" d="M12 2.4 19.5 5v5.8c0 4.8-3.1 8.7-7.5 10.8-4.4-2.1-7.5-6-7.5-10.8V5L12 2.4Z" />
      <path class="symbol-stroke" d="M12 2.4 19.5 5v5.8c0 4.8-3.1 8.7-7.5 10.8-4.4-2.1-7.5-6-7.5-10.8V5L12 2.4Z" />
      <path class="symbol-stroke" d="M12 5.8v12.1M7.7 8.1h8.6M7.9 11.5h8.2" />
      <path class="symbol-spark" d="M9.2 15.4 12 17l2.8-1.6" />
    </g>

    <g v-if="symbol === 'arrow'" class="symbol-art">
      <path class="symbol-fill" d="M20.9 3.1 18.6 11l-3-2.9-6.8 6.8-2.1-2.1 6.8-6.8-3-3 10.4.1Z" />
      <path class="symbol-stroke" d="M20.9 3.1 18.6 11l-3-2.9-6.8 6.8-2.1-2.1 6.8-6.8-3-3 10.4.1Z" />
      <path class="symbol-stroke" d="M4.2 16.1 7.9 19.8M5.9 14.4 9.6 18.1M2.8 20.2h6.3" />
      <path class="symbol-spark" d="m17.2 5.1 1.6.1-.4 1.5" />
    </g>

    <g v-if="symbol === 'scroll'" class="symbol-art">
      <path class="symbol-fill" d="M7.5 3.2h9.1c1.7 0 3 1.3 3 3 0 1.1-.6 2-1.4 2.6v8.4c0 2-1.6 3.6-3.6 3.6H6.9c-1.4 0-2.5-1.1-2.5-2.5 0-1.3 1-2.4 2.3-2.5V5.4c0-1.2.8-2.2 2-2.2Z" />
      <path class="symbol-stroke" d="M8.7 3.2h7.9c1.7 0 3 1.3 3 3 0 1.1-.6 2-1.4 2.6v8.4c0 2-1.6 3.6-3.6 3.6H6.9c-1.4 0-2.5-1.1-2.5-2.5 0-1.3 1-2.4 2.3-2.5V5.4c0-1.2.8-2.2 2-2.2Z" />
      <path class="symbol-stroke" d="M15.7 3.2c-1.5.3-2.5 1.5-2.5 3 0 1.1.6 2 1.4 2.6h3.6M6.7 15.8h7.7M8.9 8.2h3M8.9 11.3h6.2M8.9 14.4h4.7" />
      <path class="symbol-spark" d="m15.3 12.8 1.2.8-1.2.8-1.2-.8 1.2-.8Z" />
    </g>

    <g v-if="symbol === 'jump'" class="symbol-art">
      <path class="symbol-fill" d="M7.2 15.2c2.1-1 3.5-2.8 4.2-5.2l-2.5-.8.9-2.8 5.2 1.7c.8.3 1.2 1.1.9 1.9l-1 3.1 2.7 1.7 3.1-1.2 1 2.6-4.1 1.6c-.4.2-.9.1-1.3-.1l-3-1.9-1.4 3.9H4.1c.2-2 1.3-3.5 3.1-4.5Z" />
      <path class="symbol-stroke" d="M7.2 15.2c2.1-1 3.5-2.8 4.2-5.2l-2.5-.8.9-2.8 5.2 1.7c.8.3 1.2 1.1.9 1.9l-1 3.1 2.7 1.7 3.1-1.2 1 2.6-4.1 1.6c-.4.2-.9.1-1.3-.1l-3-1.9-1.4 3.9H4.1c.2-2 1.3-3.5 3.1-4.5Z" />
      <circle class="symbol-fill symbol-head" cx="14.9" cy="4.1" r="1.8" />
      <circle class="symbol-stroke" cx="14.9" cy="4.1" r="1.8" />
      <path class="symbol-stroke" d="M3 12.3c1.4.2 2.8-.1 4.1-.9M2.4 16.1c.9.2 1.8.2 2.7 0" />
    </g>
  </svg>
</template>

<script setup>
const props = defineProps({
  symbol: {
    type: String,
    required: true,
    validator: value => ['sword', 'shield', 'arrow', 'scroll', 'jump'].includes(value)
  }
});
</script>

<style scoped>
.symbol-icon {
  width: 24px;
  height: 24px;
  display: inline-block;
  overflow: visible;
}

.symbol-art {
  stroke-linecap: round;
  stroke-linejoin: round;
}

.symbol-fill {
  fill: currentColor;
  opacity: 0.24;
}

.symbol-stroke {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
}

.symbol-spark {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.25;
  opacity: 0.82;
}

.symbol-head {
  opacity: 0.35;
}

/* Per guide §3 — each symbol has a distinct color */
.symbol-sword  { color: #f44336; } /* Red    — melee       */
.symbol-shield { color: #ffc107; } /* Yellow — defense     */
.symbol-arrow  { color: #4caf50; } /* Green  — ranged      */
.symbol-scroll { color: #2196f3; } /* Blue   — magic       */
.symbol-jump   { color: #9c27b0; } /* Purple — acrobatics  */
</style>
