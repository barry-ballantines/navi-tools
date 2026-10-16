#!/usr/bin/env python3

import http.server
import socketserver
import webbrowser
from pathlib import Path

PORT = 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    pass


def main():
    html_file = Path("index.html")

    if not html_file.exists():
        print("Fehler: index.html wurde nicht gefunden.")
        return

    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}"

        print("=" * 60)
        print("Nautical Navigation Server gestartet")
        print(f"URL: {url}")
        print("=" * 60)

        try:
            webbrowser.open(url)
        except Exception:
            pass

        httpd.serve_forever()


if __name__ == "__main__":
    main()