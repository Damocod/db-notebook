import { createApp } from "vue";
import App from "./App.vue";
import VMask from "@ssibrahimbas/v-mask";
import VueExcelEditor from "vue3-excel-editor";
import { Splitpanes, Pane } from "splitpanes";
import vueClickOutsideElement from "vue-click-outside-element";
import "splitpanes/dist/splitpanes.css";
import { library } from "@fortawesome/fontawesome-svg-core";
import {
  faClipboard,
  faCirclePlay,
  faCodeCompare,
  faEye,
  faFileExcel,
  faFloppyDisk,
  faLeaf,
  faPencil,
  faRotate,
  faSearch,
  faTrash,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

library.add(faClipboard);
library.add(faCirclePlay);
library.add(faCodeCompare);
library.add(faEye);
library.add(faFileExcel);
library.add(faFloppyDisk);
library.add(faLeaf);
library.add(faPencil);
library.add(faRotate);
library.add(faSearch);
library.add(faTrash);
library.add(faTimes);

const app = createApp(App);
app.component("Splitpanes", Splitpanes);
app.component("Pane", Pane);
app.component("fa", FontAwesomeIcon);
app.use(VMask);
app.use(vueClickOutsideElement);
app.use(VueExcelEditor);
app.mount("#app");
