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

- `app/src/main/java/io/volynetstyle/nightfield/MainActivity.kt` — разрешения,
  CameraX, предпросмотр, съёмка, сохранение файлов, фокус и масштабирование.
- `web/www/` — только разметка, стили и отображение состояния. Прозрачный
  WebView находится поверх нативного предпросмотра и передаёт нажатия и жесты
  в Kotlin. Для страницы используются локальные ресурсы; сеть не требуется.
- `CaptureGate.kt` — последовательность действий во время асинхронного
  сохранения фото и записи видео.

## Сборка в Windows

Требуются Android 8.0 (API 26) или новее на телефоне и Android SDK Platform 36
с Build Tools 36 для сборки. Первичная настройка загружает Pixi, Gradle и JDK в
папку проекта, без глобальной установки:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run.ps1 build
```

Debug APK: `app/build/outputs/apk/debug/app-debug.apk`. У приложения отдельный
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
.\.android-sdk\platform-tools\adb.exe install -r .\app\build\outputs\apk\debug\app-debug.apk
```

Если SDK расположен в другом месте, используйте `adb` из его `platform-tools`.
При первом запуске разрешите доступ к камере. Микрофон запрашивается только при
записи видео; без него приложение записывает видео без звука. На Android 8–9
дополнительно запрашивается разрешение на запись файлов.

Проверки состояния съёмки:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run.ps1 test
```
