#!/usr/bin/env python3
"""Пересчитывает VERSION в sw.js по содержимому файлов приложения.

Запускать после любых правок в css/, js/, icons/, index.html или manifest —
тогда у установленного приложения появится кнопка «Обновить».
"""
import hashlib
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
sw = root / 'sw.js'
text = sw.read_text(encoding='utf-8')
shell = re.findall(r"^\s*'([^']+)',\s*$", text.split('const SHELL = [', 1)[1].split('];', 1)[0], re.M)
h = hashlib.sha1()
for name in shell:
    path = root / ('index.html' if name == './' else name)
    h.update(name.encode())
    h.update(path.read_bytes())
version = f"semestr-{h.hexdigest()[:10]}"
text = re.sub(r"const VERSION = '[^']*';", f"const VERSION = '{version}';", text, count=1)
sw.write_text(text, encoding='utf-8')
print(version)
