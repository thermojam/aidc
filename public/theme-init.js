// Blocking, same-origin bootstrap: apply the saved theme before the first paint.
try {
    const saved = localStorage.getItem("appearance");
    document.documentElement.dataset.theme = saved === "light" || saved === "dark"
        ? saved : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
} catch {
    document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
