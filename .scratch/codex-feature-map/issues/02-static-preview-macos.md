# 02 — Завершить отрицательные проверки статического Preview

**What to build:** Пользователь открывает HTML и SVG как безопасный статический результат на macOS.

**Blocked by:** None — can start immediately.

**Status:** blocked — runtime network/file journaling and viewer actions require the app window; CUA cannot open the current app bundle

- [ ] Сетевой и файловый журнал не фиксирует запрещённых действий из Preview, включая iframe, навигацию, формы и внешние ресурсы.
- [ ] Все доступные команды приложения отклоняются из недоверенного viewer; экспорт не исполняет содержимое.
