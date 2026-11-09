# 18 — Изолированный запуск команд

**What to build:** Агент запускает конкретную одобренную команду в ограниченной среде и показывает результат.

**Blocked by:** 16 — Подключить агентный цикл к SimpleClaw.

**Status:** blocked — the macOS sandbox could not pass a positive synthetic Git run

**Check, 9 November 2026:** `sandbox-exec` is present, but the restricted profile terminated the synthetic repo command (signal, no output). The system Git also tried to create an Xcode cache outside the selected folder. A bounded control run with the already-installed Homebrew Git failed the same way. No command execution implementation was retained; do not enable this feature until a supported sandbox passes positive and negative runtime checks.

- [ ] Перед запуском пользователь видит команду и её область доступа; отказ не запускает процесс.
- [ ] Пределы времени и вывода, запрет доступа вне выбранной области и правила сети проверены отрицательными сценариями.
