#!/usr/bin/env python3
"""Семестр для Mac: запускает учебный дашборд на этом компьютере и хранит всё в папке на диске.

Запуск: двойной щелчок по «Семестр.command» или в Терминале:  python3 server.py
Адрес:  http://localhost:8417
Данные: папка «Данные» рядом с этим файлом:
    semestr.json   расписание, дела, заметки, настройки
    Файлы/         загруженные файлы, разложенные по предметам
    Копии/         копия данных за каждый день (последние 60)
    Корзина/       удалённые файлы (хранятся 30 дней)

Другая папка для данных: SEMESTR_DATA=/путь/к/папке python3 server.py
"""
import datetime
import io
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get('SEMESTR_PORT', '8417'))
HERE = os.path.dirname(os.path.abspath(__file__))


def find_app():
    for path in (os.environ.get('SEMESTR_APP'), os.path.join(HERE, 'app'), os.path.dirname(HERE), HERE):
        if path and os.path.isfile(os.path.join(path, 'index.html')):
            return os.path.realpath(path)
    sys.exit('Не нашёл файлы Семестра: рядом с server.py должна быть папка app с index.html')


APP = find_app()
DATA = os.path.abspath(os.environ.get('SEMESTR_DATA') or os.path.join(HERE, 'Данные'))
STATE = os.path.join(DATA, 'semestr.json')
INDEX = os.path.join(DATA, '.files.json')
FILES = os.path.join(DATA, 'Файлы')
TRASH = os.path.join(DATA, 'Корзина')
BACKUPS = os.path.join(DATA, 'Копии')
KEEP_BACKUPS = 60
TRASH_DAYS = 30
NO_SUBJECT = 'Без предмета'
CHUNK = 1 << 20
MAX_STATE = 64 << 20
ID_RE = re.compile(r'^[A-Za-z0-9_-]{1,80}$')
LOCK = threading.RLock()
ALLOWED_HOSTS = {f'localhost:{PORT}', f'127.0.0.1:{PORT}'}

mimetypes.add_type('application/manifest+json', '.webmanifest')
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('text/markdown', '.md')

README = """Здесь Семестр хранит ваши данные.

semestr.json — расписание, дела, заметки к занятиям и настройки.
Файлы/       — всё, что вы загрузили, по папкам предметов. Файлы можно открывать и копировать,
               но переименовывать и удалять лучше в самом Семестре.
Копии/       — копия semestr.json за каждый день. Чтобы вернуться к старой версии,
               в Семестре откройте Настройки → Резервная копия → Восстановить и выберите файл отсюда.
Корзина/     — удалённые в Семестре файлы. Через 30 дней они удаляются насовсем.
"""

# ---------- Файлы и папки ----------

def safe_name(name, fallback='Файл'):
    """Имя, которое можно положить на диск Mac: без «/» и «:», без точки в начале, не длиннее 200 байт."""
    name = unicodedata.normalize('NFC', str(name or ''))
    name = re.sub(r'[\x00-\x1f/\\:]', ' ', name)
    name = re.sub(r'\s+', ' ', name).strip().lstrip('.').strip()
    if len(name.encode('utf-8')) > 200:
        base, ext = os.path.splitext(name)
        ext = ext if len(ext) <= 12 else ''
        while len((base + ext).encode('utf-8')) > 200:
            base = base[:-1]
        name = base.rstrip() + ext
    return name or fallback


def unique_path(folder, name):
    base, ext = os.path.splitext(name)
    path = os.path.join(folder, name)
    n = 2
    while os.path.exists(path):
        path = os.path.join(folder, f'{base} ({n}){ext}')
        n += 1
    return path


def same_name(actual, wanted):
    """«Лекция (2).pdf» — это всё ещё «Лекция.pdf», просто такое имя уже было занято."""
    if actual == wanted:
        return True
    base, ext = os.path.splitext(wanted)
    return re.fullmatch(re.escape(base) + r' \(\d+\)' + re.escape(ext), actual) is not None


def read_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def prepare():
    for folder in (DATA, FILES, TRASH, BACKUPS):
        os.makedirs(folder, exist_ok=True)
    readme = os.path.join(DATA, 'Что здесь.txt')
    if not os.path.exists(readme):
        with open(readme, 'w', encoding='utf-8') as f:
            f.write(README)
    # Корзина чистится сама
    limit = time.time() - TRASH_DAYS * 86400
    for name in os.listdir(TRASH):
        path = os.path.join(TRASH, name)
        try:
            if os.path.isfile(path) and os.path.getmtime(path) < limit:
                os.remove(path)
        except OSError:
            pass


def subject_folder(state, file_id):
    """Папка предмета, к которому в Семестре привязан файл."""
    subjects = {s.get('id'): s.get('name') for s in state.get('subjects', []) if isinstance(s, dict)}
    for f in state.get('files', []):
        if isinstance(f, dict) and f.get('id') == file_id:
            return os.path.join(FILES, safe_name(subjects.get(f.get('subjectId')) or NO_SUBJECT)), f
    return os.path.join(FILES, NO_SUBJECT), None


def organize(state):
    """Раскладывает файлы по папкам предметов: сменили предмет или имя в Семестре — файл переезжает."""
    index = read_json(INDEX, {})
    changed = False
    for f in state.get('files', []):
        if not isinstance(f, dict):
            continue
        entry = index.get(f.get('id'))
        if not entry:
            continue
        current = os.path.join(DATA, entry['path'])
        if not os.path.isfile(current):
            continue
        folder, _ = subject_folder(state, f['id'])
        wanted = safe_name(f.get('name'))
        if os.path.dirname(current) == folder and same_name(os.path.basename(current), wanted):
            continue
        os.makedirs(folder, exist_ok=True)
        target = unique_path(folder, wanted)
        os.replace(current, target)
        entry['path'] = os.path.relpath(target, DATA)
        changed = True
        remove_empty(os.path.dirname(current))
    if changed:
        write_json(INDEX, index)


def remove_empty(folder):
    if os.path.dirname(folder) == FILES:
        try:
            os.rmdir(folder)
        except OSError:
            pass


def backup():
    """Копия данных за сегодня; старше 60 дней удаляются."""
    today = datetime.date.today().isoformat()
    shutil.copyfile(STATE, os.path.join(BACKUPS, f'semestr-{today}.json'))
    copies = sorted(n for n in os.listdir(BACKUPS) if n.startswith('semestr-') and n.endswith('.json'))
    for name in copies[:-KEEP_BACKUPS]:
        try:
            os.remove(os.path.join(BACKUPS, name))
        except OSError:
            pass


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    server_version = 'Semestr'

    def log_message(self, fmt, *args):  # без журнала каждого запроса
        pass

    # Только этот компьютер и только сам Семестр: чужие сайты не должны читать и менять данные
    def allowed(self, write=False):
        if self.headers.get('Host', '') not in ALLOWED_HOSTS:
            self.send_error(403, 'Forbidden host')
            return False
        origin = self.headers.get('Origin')
        if write and origin and urllib.parse.urlsplit(origin).netloc not in ALLOWED_HOSTS:
            self.send_error(403, 'Forbidden origin')
            return False
        return True

    def reply(self, status, body=b'', ctype='application/json; charset=utf-8', headers=None):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body and self.command != 'HEAD':
            self.wfile.write(body)

    def reply_json(self, data, status=200):
        self.reply(status, json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def route(self):
        url = urllib.parse.urlsplit(self.path)
        return urllib.parse.unquote(url.path), urllib.parse.parse_qs(url.query)

    def read_body_to(self, out, limit=None):
        length = int(self.headers.get('Content-Length') or 0)
        if limit is not None and length > limit:
            raise ValueError('too large')
        left = length
        while left > 0:
            chunk = self.rfile.read(min(CHUNK, left))
            if not chunk:
                raise ValueError('connection closed')
            out.write(chunk)
            left -= len(chunk)
        return length

    def do_GET(self):
        if not self.allowed():
            return
        path, query = self.route()
        if path == '/api/state':
            return self.get_state()
        if path == '/api/info':
            return self.reply_json({'dir': DATA, 'free': shutil.disk_usage(DATA).free})
        if path.startswith('/api/files/'):
            return self.get_file(path[len('/api/files/'):], 'download' in query)
        if path.startswith('/api/'):
            return self.reply_json({'error': 'not found'}, 404)
        return self.static(path)

    do_HEAD = do_GET

    def do_PUT(self):
        if not self.allowed(write=True):
            return
        path, _ = self.route()
        if path == '/api/state':
            return self.put_state()
        if path.startswith('/api/files/'):
            return self.put_file(path[len('/api/files/'):])
        self.reply_json({'error': 'not found'}, 404)

    def do_DELETE(self):
        if not self.allowed(write=True):
            return
        path, _ = self.route()
        if path.startswith('/api/files/'):
            return self.delete_file(path[len('/api/files/'):])
        self.reply_json({'error': 'not found'}, 404)

    def do_POST(self):
        if not self.allowed(write=True):
            return
        path, query = self.route()
        if path == '/api/reveal':
            return self.reveal((query.get('id') or [''])[0])
        self.reply_json({'error': 'not found'}, 404)

    # --- данные ---

    def get_state(self):
        with LOCK:
            try:
                with open(STATE, 'rb') as f:
                    raw = f.read()
            except OSError:
                return self.reply_json({'error': 'empty'}, 404)
        try:
            tag = '"%s"' % json.loads(raw.decode('utf-8')).get('ver', '')
        except ValueError:
            tag = '""'
        if self.headers.get('If-None-Match') == tag:
            return self.reply(304, headers={'ETag': tag})
        self.reply(200, raw, headers={'ETag': tag})

    def put_state(self):
        try:
            buf = io.BytesIO()
            self.read_body_to(buf, MAX_STATE)
            data = json.loads(buf.getvalue().decode('utf-8'))
            if not isinstance(data, dict):
                raise ValueError('not an object')
        except ValueError as e:
            return self.reply_json({'error': str(e)}, 400)
        with LOCK:
            write_json(STATE, data)
            backup()
            organize(data)
        self.reply_json({'ok': True})

    # --- файлы ---

    def put_file(self, file_id):
        if not ID_RE.match(file_id):
            return self.reply_json({'error': 'bad id'}, 400)
        name = safe_name(urllib.parse.unquote(self.headers.get('X-File-Name', '')))
        ctype = self.headers.get('Content-Type', 'application/octet-stream').split(';')[0].strip()
        tmp = os.path.join(DATA, f'.upload-{file_id}-{threading.get_ident()}')
        try:
            with open(tmp, 'wb') as out:
                self.read_body_to(out)
        except (OSError, ValueError) as e:
            try:
                os.remove(tmp)
            except OSError:
                pass
            return self.reply_json({'error': str(e)}, 400)
        with LOCK:
            index = read_json(INDEX, {})
            entry = index.get(file_id)
            old = os.path.join(DATA, entry['path']) if entry else None
            if old and os.path.isfile(old):
                target = old  # тот же файл загружен ещё раз — заменяем
            else:
                folder, meta = subject_folder(read_json(STATE, {}), file_id)
                os.makedirs(folder, exist_ok=True)
                target = unique_path(folder, safe_name(meta.get('name')) if meta else name)
            os.replace(tmp, target)
            index[file_id] = {'path': os.path.relpath(target, DATA), 'type': ctype}
            write_json(INDEX, index)
        self.reply_json({'id': file_id})

    def file_path(self, file_id):
        entry = read_json(INDEX, {}).get(file_id) if ID_RE.match(file_id) else None
        if not entry:
            return None, None
        path = os.path.join(DATA, entry['path'])
        return (path, entry.get('type')) if os.path.isfile(path) else (None, None)

    def get_file(self, file_id, download):
        path, ctype = self.file_path(file_id)
        if not path:
            return self.reply_json({'error': 'not found'}, 404)
        size = os.path.getsize(path)
        ctype = ctype or mimetypes.guess_type(path)[0] or 'application/octet-stream'
        disp = 'attachment' if download else 'inline'
        name = urllib.parse.quote(os.path.basename(path))
        start, end = 0, size - 1
        status = 200
        # Safari проигрывает видео только с докачкой по кускам
        rng = re.match(r'bytes=(\d*)-(\d*)$', self.headers.get('Range', ''))
        if rng and size:
            if rng.group(1):
                start = int(rng.group(1))
                end = min(int(rng.group(2)), size - 1) if rng.group(2) else size - 1
            else:
                start = max(0, size - int(rng.group(2) or 0))
            if start > end:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.end_headers()
                return
            status = 206
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(end - start + 1 if size else 0))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Disposition', f"{disp}; filename*=UTF-8''{name}")
        self.send_header('Cache-Control', 'no-store')
        if status == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        if self.command == 'HEAD' or not size:
            return
        with open(path, 'rb') as f:
            f.seek(start)
            left = end - start + 1
            try:
                while left > 0:
                    chunk = f.read(min(CHUNK, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def delete_file(self, file_id):
        with LOCK:
            path, _ = self.file_path(file_id)
            index = read_json(INDEX, {})
            if path:
                os.replace(path, unique_path(TRASH, os.path.basename(path)))
                remove_empty(os.path.dirname(path))
            if file_id in index:
                del index[file_id]
                write_json(INDEX, index)
        self.reply_json({'deleted': bool(path)})

    def reveal(self, file_id):
        path = self.file_path(file_id)[0] if file_id else DATA
        if not path:
            return self.reply_json({'error': 'not found'}, 404)
        if sys.platform != 'darwin':
            return self.reply_json({'error': 'Finder есть только на Mac'}, 501)
        subprocess.Popen(['open', '-R', path] if file_id else ['open', path])
        self.reply_json({'ok': True})

    # --- сам Семестр ---

    def static(self, path):
        rel = path.lstrip('/') or 'index.html'
        full = os.path.realpath(os.path.join(APP, rel))
        if not full.startswith(APP + os.sep) or not os.path.isfile(full):
            return self.reply(404, 'Не найдено'.encode('utf-8'), 'text/plain; charset=utf-8')
        with open(full, 'rb') as f:
            body = f.read()
        if rel == 'index.html':
            # Страница узнаёт, что данные надо хранить на диске
            info = json.dumps({'dir': DATA}).replace('</', '<\\/')
            body = body.replace(b'</head>', f'<script>window.SEMESTR_DISK = {info};</script>\n</head>'.encode('utf-8'), 1)
        ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        if ctype.startswith('text/') or ctype in ('application/json', 'application/manifest+json'):
            ctype += '; charset=utf-8'
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)


def already_running(url):
    try:
        with urllib.request.urlopen(url + 'api/info', timeout=2) as res:
            return 'dir' in json.loads(res.read().decode('utf-8'))
    except Exception:  # noqa: BLE001 — любой ответ, кроме нашего, значит «не Семестр»
        return False


def main():
    if sys.version_info < (3, 7):
        sys.exit('Нужен Python 3.7 или новее')
    url = f'http://localhost:{PORT}/'
    open_browser = '--no-browser' not in sys.argv
    prepare()
    try:
        server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError:
        if already_running(url):
            print(f'Семестр уже запущен: {url}')
            if open_browser:
                webbrowser.open(url)
            return
        sys.exit(f'Порт {PORT} занят другой программой. Закройте её или запустите так: SEMESTR_PORT=8418 python3 server.py')
    server.daemon_threads = True
    print(f'Семестр запущен: {url}')
    print(f'Данные хранятся в папке: {DATA}')
    print('Не закрывайте это окно, пока пользуетесь Семестром. Остановить — Ctrl+C или закрыть окно.')
    sys.stdout.flush()
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nСеместр остановлен. Данные сохранены.')


if __name__ == '__main__':
    main()
