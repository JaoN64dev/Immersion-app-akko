// Light or dark (Settings → Display → theme): "auto" follows the computer's setting, through CSS
// alone (style.css, the end); "light" / "dark" put theme-light / theme-dark on <html>. dark-auto
// marks "auto while the computer is dark", for the few colours CSS variables don't cover.

import { store } from "./utils.js";

const SETTINGS = "akko-settings";
const osDark = matchMedia("(prefers-color-scheme: dark)");

export const theme = () => store.get(SETTINGS, {}).theme || "auto";

export function applyTheme() {
    const t = theme();
    const root = document.documentElement;
    root.classList.toggle("theme-dark", t === "dark");
    root.classList.toggle("theme-light", t === "light");
    root.classList.toggle("dark-auto", t === "auto" && osDark.matches);
}

export function setTheme(t) {
    store.set(SETTINGS, { ...store.get(SETTINGS, {}), theme: t });
    applyTheme();
}

export function start() {
    applyTheme();
    osDark.addEventListener("change", applyTheme);
    // changed in another tab or window
    addEventListener("storage", (e) => { if (e.key === SETTINGS) applyTheme(); });
}
