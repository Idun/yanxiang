<script setup lang="ts">
import { computed } from "vue";
import { extractReaderEvaluation } from "../prompts/readerAgent";
import ReaderCard from "./ReaderCard.vue";

const props = defineProps<{
  /** AI 回复正文（含 ```json ``` 读者评估块）。 */
  content: string;
}>();

const result = computed(() => extractReaderEvaluation(props.content));
</script>

<template>
  <ReaderCard v-if="result" :result="result" />
</template>
