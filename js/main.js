import { COPY } from "./data.js";
import { boot } from "./ui.js";

if (location.protocol === "file:") {
  document.body.className = "file-warn";
  document.body.textContent = COPY.file;
} else {
  boot();
}
