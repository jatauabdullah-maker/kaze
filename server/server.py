import json
import logging
import os
import queue
import re
import subprocess
import sys
import threading
import time
import uuid
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(ROOT, "bin")
YTDLP = os.path.join(BIN, "yt-dlp.exe")
FFMPEG_DIR = BIN
DOWNLOAD_DIR = os.path.join(os.path.expanduser("~"), "Downloads", "KazeVideos")
HISTORY_FILE = os.path.join(ROOT, "history.json")
PID_FILE = os.path.join(ROOT, "server.pid")

PORT = 8619
VERSION = "2.0.0"
PROTOCOL = 1
MAX_PARALLEL = 3
SITE_URL = "https://kaze-downloader.vercel.app"

QUALITIES = {"best", "2160", "1440", "1080", "720", "480", "360"}
AUDIO_FORMATS = {"mp3", "m4a"}

lock = threading.RLock()
jobs = {}
sse_clients = []
history = []

CREATE_NO_WINDOW = 0x08000000

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(os.path.join(ROOT, "kaze-server.log"), encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("kaze")


def load_history():
    global history
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            history = json.load(f)
    except Exception:
        history = []


def save_history():
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history[-300:], f, indent=1)
    except Exception:
        pass


def broadcast(event, data):
    payload = json.dumps({"event": event, "data": data})
    with lock:
        dead = []
        for q in sse_clients:
            try:
                q.put_nowait(payload)
            except Exception:
                dead.append(q)
        for q in dead:
            if q in sse_clients:
                sse_clients.remove(q)


def job_public(j):
    return {
        "id": j["id"],
        "url": j["url"],
        "title": j["title"],
        "status": j["status"],
        "mode": j["mode"],
        "quality": j["quality"],
        "audioFormat": j["audio_format"],
        "filename": j["filename"],
        "error": j["error"],
        "percent": j["percent"],
        "downloaded": j["downloaded"],
        "total": j["total"],
        "speed": j["speed"],
        "eta": j["eta"],
        "addedAt": j["added_at"],
        "finishedAt": j["finished_at"],
    }


def push_job(j):
    broadcast("job", job_public(j))


def friendly_error(text):
    t = text.lower()
    if "sign in to confirm" in t or "not a bot" in t:
        return "YouTube is asking for a sign-in/bot check on this one. Try again later, or run Kaze.bat option 1 to update yt-dlp."
    if "age" in t and ("confirm" in t or "restrict" in t):
        return "This video is age-restricted and needs sign-in. Kaze local mode cannot bypass that."
    if "unsupported url" in t:
        return "That link is not supported by yt-dlp. Double-check the URL."
    if "private video" in t:
        return "That video is private."
    if "unavailable" in t or "removed" in t:
        return "That video is unavailable or removed."
    if "429" in t or "too many requests" in t:
        return "Rate limited by the source. Wait a bit and retry."
    if "ffmpeg" in t:
        return "FFmpeg problem - run Kaze.bat option 1 to reinstall components."
    return None


def build_args(job):
    a = [
        YTDLP,
        "--ffmpeg-location", FFMPEG_DIR,
        "--windows-filenames",
        "--newline",
        "--progress",
        "--no-color",
        "--progress-template",
        "download:KAZEPROG|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s",
        "-P", DOWNLOAD_DIR,
        "-o", "%(title)s [%(id)s].%(ext)s",
        "--print", "KAZETITLE|%(title)s",
        "--print", "after_move:KAZEFILE|%(filepath)s",
    ]
    if job["mode"] == "audio":
        a += ["-x", "--audio-format", job["audio_format"], "--embed-thumbnail", "--embed-metadata"]
    else:
        if job["quality"] == "best":
            a += ["-f", "bv*+ba/b"]
        else:
            a += ["-f", f"bv*[height<={job['quality']}]+ba/b[height<={job['quality']}]"]
        a += ["--merge-output-format", "mp4"]
        if job["thumbnail"]:
            a += ["--embed-thumbnail"]
        if job["metadata"]:
            a += ["--embed-metadata"]
        if job["subs"]:
            a += ["--embed-subs", "--write-auto-subs", "--sub-langs", "en.*"]
    if job["sponsorblock"]:
        a += ["--sponsorblock-remove", "all"]
    if not job["playlist"]:
        a += ["--no-playlist"]
    a.append(job["url"])
    return a


def worker(job_id):
    j = jobs[job_id]
    j["status"] = "running"
    push_job(j)
    started = time.time()

    def set_status(status, error=None):
        j["status"] = status
        j["error"] = error
        push_job(j)

    try:
        proc = subprocess.Popen(
            build_args(j),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=DOWNLOAD_DIR,
            creationflags=CREATE_NO_WINDOW,
        )
        j["proc"] = proc
        err_tail = deque(maxlen=40)

        def drain_err():
            for line in proc.stderr:
                err_tail.append(line.rstrip())

        terr = threading.Thread(target=drain_err, daemon=True)
        terr.start()

        filepath = None
        for line in proc.stdout:
            line = line.strip()
            if j.get("cancel"):
                break
            if not line:
                continue
            if line.startswith("KAZETITLE|"):
                j["title"] = line.split("|", 1)[1]
                push_job(j)
                continue
            if line.startswith("KAZEFILE|"):
                filepath = line.split("|", 1)[1]
                continue
            if line.startswith("KAZEPROG|"):
                parts = line.split("|")
                try:
                    def num(idx, default):
                        v = parts[idx] if len(parts) > idx else "NA"
                        return float(v) if v not in ("NA", "None", "") else default
                    j["downloaded"] = int(num(1, j["downloaded"]))
                    total = num(2, 0) or num(3, 0)
                    if total:
                        j["total"] = int(total)
                    j["speed"] = num(4, 0)
                    eta = num(5, None)
                    j["eta"] = int(eta) if eta is not None else None
                    if j["downloaded"] and j["total"]:
                        j["percent"] = round(j["downloaded"] * 100.0 / j["total"], 1)
                    push_job(j)
                except (ValueError, IndexError):
                    pass

        rc = proc.wait()
        terr.join(timeout=2)

        if j.get("cancel"):
            set_status("cancelled")
        elif rc == 0:
            size = 0
            name = j["title"] or "video"
            if filepath and os.path.exists(filepath):
                size = os.path.getsize(filepath)
                name = os.path.basename(filepath)
            j["filename"] = name
            j["percent"] = 100.0
            set_status("done")
            with lock:
                history.append({
                    "id": j["id"],
                    "url": j["url"],
                    "title": j["title"] or name,
                    "filename": name,
                    "filepath": filepath,
                    "size": size,
                    "mode": j["mode"],
                    "quality": j["quality"],
                    "seconds": round(time.time() - started, 1),
                    "finishedAt": int(time.time()),
                })
                del history[:-300]
            save_history()
            broadcast("history", history[-300:])
        else:
            raw = " ".join(err_tail) if err_tail else ""
            msg = friendly_error(raw)
            if not msg:
                last = err_tail[-1] if err_tail else f"yt-dlp exited with code {rc}"
                msg = f"{last[:220]} If this keeps happening, run Kaze.bat option 1 to update yt-dlp."
            set_status("error", msg)
    except OSError as e:
        if getattr(e, "winerror", None) in (193, 216):
            set_status("error", "yt-dlp looks broken or was not downloaded properly - run Kaze.bat option 1 to repair.")
        else:
            set_status("error", str(e))
    except Exception as e:
        set_status("error", str(e))
    finally:
        j.pop("proc", None)


def scheduler():
    while True:
        time.sleep(0.5)
        with lock:
            running = sum(1 for x in jobs.values() if x["status"] == "running")
            if running >= MAX_PARALLEL:
                continue
            queued = [x for x in jobs.values() if x["status"] == "queued"]
            queued.sort(key=lambda x: x["added_at"])
            for q in queued[: MAX_PARALLEL - running]:
                threading.Thread(target=worker, args=(q["id"],), daemon=True).start()


def origin_ok(origin):
    if not origin:
        return True
    if origin == SITE_URL:
        return True
    m = re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", origin)
    return bool(m)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        log.info("%s - %s", self.address_string(), fmt % args)

    def cors(self):
        o = self.headers.get("Origin", "")
        self.send_header("Access-Control-Allow-Origin", o if origin_ok(o) else "null")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/ping":
            self.send_json({
                "ok": True,
                "name": "kaze-server",
                "version": VERSION,
                "protocol": PROTOCOL,
                "downloadsDir": DOWNLOAD_DIR,
            })
        elif path == "/state":
            with lock:
                self.send_json({
                    "server": {"ok": True, "version": VERSION, "protocol": PROTOCOL},
                    "downloadsDir": DOWNLOAD_DIR,
                    "jobs": [job_public(j) for j in jobs.values()],
                    "history": history[-300:],
                })
        elif path == "/events":
            self.handle_events()
        elif path == "/" :
            body = (
                "<!doctype html><meta charset='utf-8'><title>Kaze Server</title>"
                "<body style='font-family:system-ui;background:#0b0c10;color:#e5e7eb;"
                "display:grid;place-items:center;height:100vh;margin:0'>"
                "<div style='text-align:center'>"
                "<h1 style='margin:0 0 8px'>Kaze Server is running</h1>"
                f"<p style='opacity:.75;margin:0'>Open <a style='color:#7dd3fc' href='{SITE_URL}' target='_blank'>{SITE_URL.replace('https://','')}</a> to use it</p>"
                "</div></body>"
            ).encode()
            self.send_response(200)
            self.cors()
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/favicon.ico":
            self.send_response(204)
            self.cors()
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self.send_json({"ok": False, "error": "not found"}, 404)

    def handle_events(self):
        myq = queue.Queue()
        with lock:
            sse_clients.append(myq)
        self.send_response(200)
        self.cors()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            hello = json.dumps({"event": "hello", "data": {"version": VERSION, "protocol": PROTOCOL}})
            self.wfile.write(f"data: {hello}\n\n".encode())
            self.wfile.flush()
            while True:
                try:
                    payload = myq.get(timeout=15)
                    self.wfile.write(f"data: {payload}\n\n".encode())
                except Exception:
                    self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except Exception:
            pass
        finally:
            with lock:
                if myq in sse_clients:
                    sse_clients.remove(myq)

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/jobs":
            self.send_json({"ok": False, "error": "not found"}, 404)
            return
        if (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json":
            self.send_json({"ok": False, "error": "content-type must be application/json"}, 415)
            return
        try:
            length = min(int(self.headers.get("Content-Length") or 0), 10000)
            data = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self.send_json({"ok": False, "error": "bad json"}, 400)
            return
        url = str(data.get("url") or "").strip()
        if not re.match(r"^https?://", url):
            self.send_json({"ok": False, "error": "a direct link is required"}, 400)
            return
        mode = data.get("mode", "video")
        quality = str(data.get("quality", "best"))
        audio_format = str(data.get("audioFormat", "mp3"))
        if mode not in ("video", "audio"):
            mode = "video"
        if quality not in QUALITIES:
            quality = "best"
        if audio_format not in AUDIO_FORMATS:
            audio_format = "mp3"
        job = {
            "id": uuid.uuid4().hex[:12],
            "url": url,
            "title": None,
            "status": "queued",
            "mode": mode,
            "quality": quality,
            "audio_format": audio_format,
            "thumbnail": bool(data.get("thumbnail", True)),
            "metadata": bool(data.get("metadata", True)),
            "subs": bool(data.get("subs", False)),
            "sponsorblock": bool(data.get("sponsorblock", False)),
            "playlist": bool(data.get("playlist", False)),
            "filename": None,
            "error": None,
            "percent": 0.0,
            "downloaded": 0,
            "total": 0,
            "speed": 0,
            "eta": None,
            "added_at": time.time(),
            "finished_at": None,
        }
        with lock:
            jobs[job["id"]] = job
        push_job(job)
        self.send_json({"ok": True, "job": job_public(job)}, 201)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        parts = parsed.path.strip("/").split("/")
        if parts[0] == "history" and len(parts) == 2:
            hid = parts[1]
            deleted_file = False
            with lock:
                entry = next((h for h in history if h.get("id") == hid), None)
                if not entry:
                    self.send_json({"ok": False, "error": "not in history"}, 404)
                    return
                history.remove(entry)
                save_history()
                fp = entry.get("filepath")
                if qs.get("file", ["0"])[0] == "1" and fp and os.path.abspath(fp).startswith(os.path.abspath(DOWNLOAD_DIR)) and os.path.exists(fp):
                    try:
                        os.remove(fp)
                        deleted_file = True
                    except OSError:
                        pass
            broadcast("history", history[-300:])
            self.send_json({"ok": True, "fileDeleted": deleted_file})
            return
        if parts[0] == "jobs" and len(parts) == 2:
            jid = parts[1]
            with lock:
                j = jobs.get(jid)
                if not j:
                    self.send_json({"ok": False, "error": "no such job"}, 404)
                    return
                if j["status"] in ("done", "error", "cancelled"):
                    self.send_json({"ok": False, "error": "already finished"}, 409)
                    return
                j["cancel"] = True
                proc = j.get("proc")
            if proc:
                try:
                    proc.terminate()
                except Exception:
                    pass
            self.send_json({"ok": True})
            return
        self.send_json({"ok": False, "error": "not found"}, 404)


def bind_server():
    while True:
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
            srv.daemon_threads = True
            srv.handle_error = _swallow_connection_errors
            return srv
        except OSError as e:
            if getattr(e, "winerror", None) == 10048:
                try:
                    import urllib.request
                    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/ping", timeout=2) as r:
                        if r.status == 200:
                            log.info("another Kaze Server already owns port %s - nothing to do", PORT)
                            sys.exit(0)
                except Exception:
                    pass
                log.info("port %s busy - retrying in 2s", PORT)
                time.sleep(2)
            else:
                raise


def main():
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    load_history()
    if not os.path.exists(YTDLP):
        log.error("yt-dlp missing - run Kaze.bat option 1 first.")
        sys.exit(1)

    srv = bind_server()
    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))
    threading.Thread(target=scheduler, daemon=True).start()
    log.info("Kaze Server v%s listening on http://127.0.0.1:%s", VERSION, PORT)
    log.info("Downloads -> %s", DOWNLOAD_DIR)
    log.info("UI -> %s", SITE_URL)

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            os.remove(PID_FILE)
        except OSError:
            pass
    log.info("stopped")


def _swallow_connection_errors(srv, handler):
    exc_type = sys.exc_info()[0]
    if exc_type in (BrokenPipeError, ConnectionResetError, TimeoutError):
        return
    log.exception("request error")


if __name__ == "__main__":
    main()
