# AI Desktop Client — локальный срез

Это тестовый чат без сетевых запросов, API-ключа и платных вызовов. Ответ формируется локально в Rust, приходит частями через Tauri Channel и сохраняется в SQLite.

Нужны Node.js 22+, Rust stable и [системные зависимости Tauri 2](https://v2.tauri.app/start/prerequisites/).

```sh
npm ci
npm run build
cd src-tauri && cargo test && cd ..
npm run tauri dev
```

Для проверки запрета команд из непривилегированного окна:

```sh
npm run tauri dev -- --config src-tauri/tauri.viewer-test.conf.json
```

Обычная сборка: `npm run tauri build -- --bundles app` на macOS. На Windows выполните [smoke-тест](docs/research/rea/smoke-windows.md) на реальной машине. Фактические результаты и границы среза записаны в [журнале](docs/research/rea/checks.md).
