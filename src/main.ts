import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
import { initPersistence } from "./persistenceBootstrap";
import { autoPairDirective } from "./autoPairPunctuation";

void initPersistence().then(() => {
  const app = createApp(App);
  /* v-auto-pair：成对标点自动补全（引号 / 书名号 / 括号…），挂在各输入框上。 */
  app.directive("autoPair", autoPairDirective);
  app.mount("#app");
});
