import { reactive } from "vue";

export const docStore = reactive({
  markdown: "",
  /* Content of the secondary (分栏) document pane. */
  secondaryMarkdown: "",
});