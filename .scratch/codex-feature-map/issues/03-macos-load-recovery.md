# 03 — Измерить нагрузку и восстановление на macOS

**What to build:** Пользователь сохраняет частичный ответ после аварии и работает с длинной историей без недоказанных обещаний скорости.

**Blocked by:** None — can start immediately.

**Status:** partially verified, blocked on interactive performance measurements — Rust recovery and partial-response tests pass, but CUA cannot operate the built application to measure UI timings

- [ ] Для фиксированных размеров истории и ответа записаны устройство, версии, время старта, открытия беседы, первого токена и задержка ввода.
- [x] Existing Rust restart/recovery tests check persisted partial text and `interrupted` status after reopen.
- [ ] Аварийный UI-тест измеряет потерю последнего текста; потерянные миллисекунды не измерены.
