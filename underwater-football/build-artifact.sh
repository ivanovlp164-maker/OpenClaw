#!/usr/bin/env bash
# Собирает однофайловую версию игры (для публикации как веб-страницы).
# Результат: dist/underwater-football.html — без <!DOCTYPE>/<html>/<head>/<body>
# (обёртка добавляется платформой публикации), но открывается и напрямую в браузере.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
OUT=dist/underwater-football.html

# Берём содержимое index.html между <head>...</head> (стили+мета) и <body>...</body>,
# заменяя внешние скрипты на инлайн.
{
  # метатеги и стили из head (кроме doctype/html/head тегов)
  sed -n '/<meta charset/,/<\/style>/p' index.html
  # тело без внешних скриптов
  sed -n '/<body>/,/<\/body>/p' index.html | sed '1d;$d' | grep -v '<script src='
  echo '<script>'
  cat vendor/three.min.js
  echo '</script>'
  echo '<script>'
  cat game.js
  echo '</script>'
} > "$OUT"
echo "OK: $OUT ($(du -h "$OUT" | cut -f1))"
