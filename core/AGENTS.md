# Инварианты core

Core зависит от семантической модели `contract/model.json`, не от Android,
iOS, WebView или DOM. Replay — тестовая reference-среда с виртуальным временем.
Сохраняй семантику отмены, упорядочивания и ограниченных очередей из
[INVARIANTS.md](../contract/INVARIANTS.md) и бюджет из
[PERFORMANCE.md](../docs/PERFORMANCE.md). После изменений запускай
`powershell -NoProfile -ExecutionPolicy Bypass -File tools/web-check.ps1`.
