# Pure Camera

Простая камера для Android на базе NightField. Ветка `pure-camera` предназначена
для обычной съёмки фото и видео. Исследовательская версия остаётся в ветке
`main`.

В приложении есть фото, видео со звуком, переключение передней и задней камер,
вспышка и фонарь при наличии на устройстве, фокусировка касанием, масштабирование
двумя пальцами и открытие последнего снимка или системной галереи. На Android 10+
файлы сохраняются в `DCIM/Pure Camera`; на Android 8–9 расположением управляет
системная медиатека.

## Архитектура

- `contract/model.json` — семантическая модель experimental/v0;
  `contract/protocol.json` — отдельный wire-протокол версии 1.
- `core/` — переносимое исполнение и replay; `hud/` — визуальная проекция.
  Исходники интерфейса, ядра, адаптера и локальных инструментов написаны на
  TypeScript; типы камеры генерируются из модели контракта.
- `platforms/android/` — WebHost, мост и CameraX-backend; только платформа
  исполняет доступ к устройству. Сгенерированные типы лежат в `contract/generated/`.
- `tools/` — локальные средства генерации, проверки и сборки.

Инварианты скорости UI и бюджеты описаны в [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
Они проверяются автоматически в Android preBuild. Отдельная локальная среда
Pixi `web-check` содержит Node 22. TypeScript и esbuild устанавливаются локально
только для проверки и сборки; runtime-библиотек нет. Сборка проверяет типы в
строгом режиме и формирует JavaScript в `hud/build/` для WebView и APK.
Описание контракта и replay: [contract/INVARIANTS.md](contract/INVARIANTS.md).

## Сборка в Windows

Требуются Android 8.0 (API 26) или новее на телефоне и Android SDK Platform 36
с Build Tools 36 для сборки. Первичная настройка загружает Pixi, Gradle и JDK в
папку проекта, без глобальной установки:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\bootstrap.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run.ps1 build
```

Debug APK: `platforms/android/build/outputs/apk/debug/android-debug.apk`. У приложения отдельный
идентификатор `io.volynetstyle.nightfield.purecamera`, поэтому оно может быть
установлено рядом с NightField.

Скрипт использует `.android-sdk/`, если локальный SDK уже находится в проекте.
Иначе берёт SDK из `ANDROID_HOME`, `ANDROID_SDK_ROOT` или
`%LOCALAPPDATA%\Android\Sdk`, не устанавливая пакеты в общий SDK автоматически.
При необходимости установите Platform 36 и Build Tools и примите лицензии.
С зависимостями Android Gradle работает через локальный кэш
`.gradle-user-home/`.

При подключённом телефоне с включённой отладкой USB:

```powershell
.\.android-sdk\platform-tools\adb.exe install -r .\platforms\android\build\outputs\apk\debug\android-debug.apk
```

Если SDK расположен в другом месте, используйте `adb` из его `platform-tools`.
При первом запуске разрешите доступ к камере. Микрофон запрашивается только при
записи видео; без него приложение записывает видео без звука. На Android 8–9
дополнительно запрашивается разрешение на запись файлов.

Проверки состояния съёмки:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run.ps1 test
```

Проверка и исправление стиля выполняются локально:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run.ps1 lint-web
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run.ps1 format-web
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run.ps1 lint-kotlin
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run.ps1 format-kotlin
```

ESLint, Prettier и ktlint проверяются при Android-сборке. Существующие замечания
Kotlin сохранены в `.ktlint-baseline.xml`: новые нарушения не должны добавляться;
`format-kotlin` применяет автоформатирование ко всем исходникам Kotlin. Генерируемые
файлы не форматируются вручную. Все инструменты устанавливаются внутри проекта.
