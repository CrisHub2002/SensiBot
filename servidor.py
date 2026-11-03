#!/usr/bin/env python3
"""Servidor local de SensiBot.

Sirve la interfaz web y hace de puente con la API de Machine Learning for Kids
para que la clave del proyecto nunca llegue al navegador.
"""

import json
import os
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlencode, urlsplit
from urllib.request import Request, urlopen

BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"
API_BASE = "https://machinelearningforkids.co.uk/api/scratch"
MAX_TEXT_LENGTH = 500
REQUEST_TIMEOUT = 20

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
}


class ModelError(Exception):
    """Error controlado al consultar el modelo."""


def load_env_file():
    """Carga variables sencillas desde .env sin dependencias externas."""
    if not ENV_FILE.exists():
        return

    for raw_line in ENV_FILE.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip()

        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]

        if name:
            os.environ.setdefault(name, value)


def get_preferred_port():
    try:
        return int(os.environ.get("PORT", "3000"))
    except ValueError:
        return 3000


load_env_file()

API_KEY = os.environ.get("ML4KIDS_API_KEY", "").strip()
HOST = os.environ.get("HOST", "127.0.0.1").strip() or "127.0.0.1"
PREFERRED_PORT = get_preferred_port()


def classify_text(text):
    """Consulta el modelo y devuelve su lista de predicciones."""
    if not API_KEY:
        raise ModelError("Falta configurar ML4KIDS_API_KEY en el archivo .env.")

    query = urlencode({"data": text})
    url = f"{API_BASE}/{quote(API_KEY, safe='')}/classify?{query}"
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "SensiBot/1.0",
        },
    )

    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            payload = json.load(response)
    except HTTPError as error:
        print(f"[modelo] La API respondió HTTP {error.code}.")
        raise ModelError("El modelo no respondió correctamente. Revisa la clave del proyecto.") from error
    except URLError as error:
        print(f"[modelo] No se pudo conectar: {error.reason}")
        raise ModelError("No se pudo conectar con Machine Learning for Kids. Revisa tu conexión a internet.") from error
    except TimeoutError as error:
        print("[modelo] La petición superó el tiempo máximo.")
        raise ModelError("El modelo tardó demasiado en responder. Inténtalo de nuevo.") from error
    except (json.JSONDecodeError, ValueError) as error:
        print("[modelo] La respuesta no era JSON válido.")
        raise ModelError("El modelo devolvió una respuesta no válida.") from error

    if not isinstance(payload, list):
        raise ModelError("El modelo devolvió un formato inesperado.")

    return payload


class SensiBotHandler(BaseHTTPRequestHandler):
    server_version = "SensiBot/1.0"
    sys_version = ""

    def do_GET(self):
        path = urlsplit(self.path).path

        if path == "/api/health":
            self.send_json(200, {"ok": True, "configured": bool(API_KEY)})
            return

        if path.startswith("/api/"):
            self.send_json(404, {"error": "Ruta de API no encontrada."})
            return

        self.serve_static(path)

    def do_POST(self):
        path = urlsplit(self.path).path

        if path != "/api/classify":
            self.send_json(404, {"error": "Ruta de API no encontrada."})
            return

        if not API_KEY:
            self.send_json(
                503,
                {"error": "Falta configurar ML4KIDS_API_KEY en el archivo .env y reiniciar el servidor."},
            )
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "La solicitud no es válida."})
            return

        if content_length <= 0 or content_length > 10_000:
            self.send_json(413, {"error": "El mensaje es demasiado largo."})
            return

        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"error": "No se pudo leer el mensaje enviado."})
            return

        if not isinstance(payload, dict):
            self.send_json(400, {"error": "El formato del mensaje no es válido."})
            return

        text = payload.get("text")

        if not isinstance(text, str):
            self.send_json(400, {"error": "Falta el texto que se quiere analizar."})
            return

        text = text.strip()

        if not text:
            self.send_json(400, {"error": "Escribe un mensaje antes de analizarlo."})
            return

        if len(text) > MAX_TEXT_LENGTH:
            self.send_json(400, {"error": f"El mensaje no puede superar los {MAX_TEXT_LENGTH} caracteres."})
            return

        try:
            predictions = classify_text(text)
        except ModelError as error:
            self.send_json(502, {"error": str(error)})
            return

        self.send_json(200, {"predictions": predictions})

    def serve_static(self, path):
        if path in ("", "/"):
            path = "/index.html"

        relative = unquote(path).lstrip("/")
        parts = Path(relative).parts

        if any(part.startswith(".") or part == "__pycache__" for part in parts):
            self.send_error(404, "Archivo no encontrado")
            return

        file_path = (BASE_DIR / relative).resolve()

        try:
            file_path.relative_to(BASE_DIR)
        except ValueError:
            self.send_error(403, "Acceso denegado")
            return

        if not file_path.is_file():
            self.send_error(404, "Archivo no encontrado")
            return

        try:
            content = file_path.read_bytes()
        except OSError:
            self.send_error(500, "No se pudo leer el archivo")
            return

        content_type = MIME_TYPES.get(file_path.suffix.lower(), "application/octet-stream")

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(content)

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)


def create_server():
    last_error = None

    for port in range(PREFERRED_PORT, PREFERRED_PORT + 11):
        try:
            server = ThreadingHTTPServer((HOST, port), SensiBotHandler)
            return server, port
        except OSError as error:
            last_error = error
            print(f"El puerto {port} está ocupado; probando otro...")

    raise RuntimeError(
        f"No se encontró un puerto libre entre {PREFERRED_PORT} y {PREFERRED_PORT + 10}."
    ) from last_error


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass

    try:
        server, port = create_server()
    except RuntimeError as error:
        print(f"\n{error}\n")
        return 1

    display_host = "localhost" if HOST in ("127.0.0.1", "0.0.0.0", "::1") else HOST
    url = f"http://{display_host}:{port}"

    print("\nSensiBot está disponible en:")
    print(f"  {url}\n")

    if API_KEY:
        print("Modelo configurado correctamente.")
    else:
        print("Aviso: falta ML4KIDS_API_KEY en el archivo .env.")
        print("La página cargará, pero no podrá analizar mensajes hasta configurarla.")

    print("\nPulsa Ctrl+C para detener el servidor.\n")

    if not os.environ.get("NO_OPEN"):
        threading.Timer(
            0.8,
            lambda: webbrowser.open(url),
        ).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
