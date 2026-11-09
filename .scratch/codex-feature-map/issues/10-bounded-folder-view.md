# 10 — Ограниченное чтение выбранной папки

**What to build:** Пользователь просматривает поддерживаемые файлы только в явно выбранной папке проекта.

**Blocked by:** 09 — Материалы проекта в запросе.

**Status:** implemented; live UI check remains open

- [x] Picker selects one folder; Rust lists direct supported children only and displays limits and file sizes.
- [x] Rust tests reject traversal, symlinks, secret names and files over the configured limit.
- [ ] Live UI check remains under issue 01.
