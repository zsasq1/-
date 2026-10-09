#!/usr/bin/env python3
"""Собирает Семестр в один файл semestr.html: стили и скрипты внутри.

Такой файл можно скачать на компьютер и открыть двойным щелчком — сайт и интернет
не нужны (без интернета только шрифты заменятся системными). Установка на телефон
и офлайн-кеш в этом режиме не работают: для них нужен адрес https.

    python3 tools/build-single.py [куда-сохранить.html]
"""
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist' / 'semestr.html'

html = (root / 'index.html').read_text(encoding='utf-8')
# Значки и описание приложения для установки из отдельного файла не загрузятся
html = re.sub(r'\s*<link rel="(manifest|apple-touch-icon)"[^>]*>', '', html)
html = re.sub(r'\s*<meta name="(mobile-web-app-capable|apple-mobile-web-app-[a-z-]+)"[^>]*>', '', html)

css = (root / 'css' / 'styles.css').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="css/styles.css">', f'<style>\n{css}</style>')


def inline(m):
    code = (root / m.group(1)).read_text(encoding='utf-8')
    if '</script' in code.lower():
        raise SystemExit(f'{m.group(1)}: внутри есть </script>, встроить нельзя')
    return f'<script>\n{code}</script>'


html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
if 'src="js/' in html or 'href="css/' in html:
    raise SystemExit('остались ссылки на отдельные файлы')

out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html, encoding='utf-8')
print(f'{out}: {len(html.encode()) // 1024} КБ')
