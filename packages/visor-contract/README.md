# VISOR: общий семантический контракт

`protocol.json` принадлежит системе VISOR, а не UI или Android. Он задаёт типы,
версию, команды, ошибки и лимиты. Web-core и physical backend зависят от него:

```text
                   visor-contract
                  /              \
         web semantic runtime    physical backend
                  |              /             \
                 HUD       Android/CameraX    future iOS
```

В текущей ветке реализованы ordinary photo/video, Android transport и replay.
В проекте нет Quant-пакета: точка его будущего подключения —
`Visor.createRuntime(backend, render)`. Существующий runtime содержит общую
проекцию состояния, арбитраж действий HUD и выбор возможностей; устройство
управляется backend. Swift-bindings сгенерированы, реализация AVFoundation
остаётся отдельной работой.

## Одна canonical definition

```powershell
.\.pixi\bin\pixi.exe run --environment web-check contract-generate
```

Генератор создаёт `bindings/index.d.ts`, `bindings/VisorContract.swift`,
Android `VisorContract.kt` и runtime definition `web/www/contract.js`.
Команда `--check` обязательна для Android preBuild и отклоняет рассинхронизацию.
Binding-файлы не редактируются вручную; форматтеры должны их пропускать.
Генерируются value types и команды, а не CameraX/AVFoundation implementation.

## Семантика версии 1

- `system.connect()` создаёт сессию. Старые callbacks и операции другой сессии
  не меняют текущий мир. Повторный connect завершает старые pending promises
  ошибкой `STALE_SESSION`.
- Все наблюдения — полные snapshots с возрастающим `sequence`. Телеметрия
  объединяется: промежуточные snapshots могут быть пропущены. Дубликаты,
  старые номера и чужая сессия игнорируются. Это не обещание частоты кадров.
- `camera.start(config)` успешно завершается только со snapshot `live`.
  Ошибка — объект `{code, message, retryable}`, а не строка или silent no-op.
- `takePhoto()` завершается после сохранения файла. `startRecording()`
  завершается после подтверждения фактического старта. `stopRecording(ref)`
  — после finalize. `CaptureId` равен ID исходной capture-команды (`rN`) и
  имеет смысл только вместе с session. Capture-фазы не откатываются.
- `onCapture()` доставляет terminal result/error отдельно от телеметрии.
  Завершённый capture не переоткрывается поздним snapshot. Watermark сохраняет
  это правило и после удаления старых tombstones.
- `cancelCapture(ref)` устанавливает логическую границу отмены: после успеха
  не публикуется успешный результат этой съёмки. Pending capture отклоняется
  с `CANCELLED`; поздние файлы отбрасываются, удаление выполняется по возможности.
  API не обещает физически мгновенную остановку сенсора/кодека. До завершения
  cleanup backend может оставаться в `cancelling` и отвечать `BUSY`.
- `camera.stop()` закрывает preview и отменяет capture. `dispose()` снимает
  подписки, завершает promises, очищает deadlines и best-effort закрывает камеру.
- Не больше 16 RPC в полёте, одноразовый deadline 30 секунд на RPC.
  В простое deadlines отсутствуют. Изменять физические настройки до ответа
  через бесконечные retry/polling запрещено. Ответы и terminal events надёжны
  в пределах подключённой сессии; bounded native outbox содержит максимум
  32 сообщения и одну latest observation, один evaluateJavascript в полёте.
- Focus/zoom — best-effort notifications, без per-touch promise/deadline.
  Координаты нормализованы 0–1, множитель zoom 0.01–100, native ограничивает
  результат фактическим диапазоном устройства. Зум объединяется раз за UI-кадр.

## Capabilities

`supported`, `unsupported`, `unknown` различаются. `unknown` разрешает попытку
конфигурации с последующей структурированной ошибкой; это не скрытое `true`.
Photo/video становятся supported после успешного binding соответствующего
режима выбранной камеры. При смене объектива знания сбрасываются.

RAW, linear video, accumulation и motion в Pure Camera объявлены unsupported:
это возможности backend, а не утверждение об отсутствии соответствующего
железа в телефоне. Методы этих будущих портов не имитируются. Для их добавления
нужны расширение схемы, реализация и conformance tests.

Контракт не обещает одинаковые timestamps, экспозицию, GPU precision,
поддержку RAW или период сенсорных событий на всех платформах.

## Replay и conformance

`replay.js` исполняет те же сообщения с виртуальным clock. Recorded observations
хранятся в `web/replay/scenario.json`; кнопка шага двигает время, фоновых таймеров
в demo нет. Полный HUD работает без телефона:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run.ps1 replay
```

Открой `http://127.0.0.1:4173`. Это демонстрационный backend: его URI и capabilities
относятся к фикстуре; реальных файлов и сенсоров нет. Общие tests проверяют
ordering, identity, отмену, terminal delivery, unknown/unsupported, потерянные
ответы, disposal и замену сессии. Они же служат conformance-набором для будущего
транспорта; аппаратное поведение проверяется отдельно на устройстве.
