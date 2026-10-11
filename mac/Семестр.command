#!/bin/bash
# Двойной щелчок запускает Семестр и открывает его в браузере.
# Окно Терминала не закрывайте, пока пользуетесь Семестром.
cd "$(dirname "$0")" || exit 1

if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)' >/dev/null 2>&1; then
  echo "Для Семестра нужен Python 3 — он входит в «Инструменты командной строки» от Apple."
  echo "Сейчас появится окно установки: нажмите «Установить», дождитесь окончания"
  echo "и снова откройте «Семестр.command»."
  xcode-select --install >/dev/null 2>&1
  echo
  read -r -p "Нажмите Enter, чтобы закрыть это окно… " _
  exit 1
fi

exec python3 server.py
