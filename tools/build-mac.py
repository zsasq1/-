#!/usr/bin/env python3
"""Собирает «Семестр для Mac» в архив dist/Семестр-для-Mac.zip.

Внутри папка «Семестр»: Семестр.command (запуск двойным щелчком), server.py
(хранит данные в папке «Данные» на диске), инструкция и папка app с самим приложением.

    python3 tools/build-mac.py
"""
import ast
import pathlib
import re
import time
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
out = root / 'dist' / 'Семестр-для-Mac.zip'
APP_FILES = ['index.html', 'manifest.webmanifest', 'sw.js']
APP_DIRS = ['css', 'js', 'icons']
MAC = root / 'mac'
EXEC = {'Семестр.command', 'server.py'}

# Сервер для Mac отдаёт только эти файлы (STATIC_* в mac/server.py), а сервис-воркер кеширует SHELL из sw.js.
# Если списки разойдутся, файл из SHELL получит 404 и офлайн-режим версии для Mac молча перестанет обновляться
tree = ast.parse((MAC / 'server.py').read_text(encoding='utf-8'))
static = {t.id: ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
          for t in n.targets if isinstance(t, ast.Name) and t.id in ('STATIC_FILES', 'STATIC_DIRS')}
if static.get('STATIC_FILES') != set(APP_FILES) or static.get('STATIC_DIRS') != set(APP_DIRS):
    raise SystemExit('списки файлов в tools/build-mac.py и STATIC_* в mac/server.py разошлись')
sw = (root / 'sw.js').read_text(encoding='utf-8')
shell = re.findall(r"^\s*'([^']+)',\s*$", sw.split('const SHELL = [', 1)[1].split('];', 1)[0], re.M)
missing = [n for n in shell if n != './' and n not in APP_FILES and n.split('/', 1)[0] not in APP_DIRS]
if missing:
    raise SystemExit(f'в версию для Mac не попадут файлы из SHELL в sw.js: {missing}')


def add(zf, src, name, mode):
    info = zipfile.ZipInfo(f'Семестр/{name}', date_time=time.localtime(src.stat().st_mtime)[:6])
    info.external_attr = (0o100000 | mode) << 16  # обычный файл с правами — чтобы .command запускался
    info.compress_type = zipfile.ZIP_DEFLATED
    zf.writestr(info, src.read_bytes())


out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out, 'w') as zf:
    for src in sorted(MAC.iterdir()):
        if src.is_file() and src.name != '.DS_Store':
            add(zf, src, src.name, 0o755 if src.name in EXEC else 0o644)
    for name in APP_FILES:
        add(zf, root / name, f'app/{name}', 0o644)
    for folder in APP_DIRS:
        for src in sorted((root / folder).rglob('*')):
            if src.is_file():
                add(zf, src, f'app/{src.relative_to(root).as_posix()}', 0o644)

with zipfile.ZipFile(out) as zf:
    names = zf.namelist()
print(f'{out}: {out.stat().st_size // 1024} КБ, файлов: {len(names)}')
