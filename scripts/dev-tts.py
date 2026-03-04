#!/usr/bin/env python3
"""Local dev server for testing the Vercel Python TTS function.

Starts a simple HTTP server on port 3001 that mirrors what Vercel will run
in production. Use this to verify the Python edge-tts path works before
deploying.

Usage:
  npm run dev:tts-python
  # or directly:
  python3 scripts/dev-tts.py

Test with curl:
  curl -X POST http://localhost:3001/api/tts \
    -H 'Content-Type: application/json' \
    -d '{"text":"Hello world, this is a test of the edge text to speech system."}' \
    --output test.mp3 && echo "Saved test.mp3"
"""

import os
import signal
import subprocess
import sys
from http.server import HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "_python"))
from tts import handler  # noqa: E402

PORT = int(os.environ.get("TTS_PORT", "3001"))

class ReusableHTTPServer(HTTPServer):
    allow_reuse_address = True
    allow_reuse_port = True


def _kill_stale_port(port: int) -> None:
    """Kill any leftover process on the port from a previous crashed run."""
    try:
        pids = subprocess.check_output(
            ["lsof", "-ti", f":{port}"], stderr=subprocess.DEVNULL, text=True
        ).strip()
        if pids:
            for pid in pids.splitlines():
                os.kill(int(pid), signal.SIGKILL)
            print(f"Killed stale process(es) on port {port}.", file=sys.stderr)
    except (subprocess.CalledProcessError, OSError):
        pass


if __name__ == "__main__":
    try:
        server = ReusableHTTPServer(("0.0.0.0", PORT), handler)
    except OSError:
        _kill_stale_port(PORT)
        server = ReusableHTTPServer(("0.0.0.0", PORT), handler)
    print(f"Edge TTS Python dev server running on http://localhost:{PORT}")
    print(f"Test: curl -X POST http://localhost:{PORT}/api/tts \\")
    print('  -H \'Content-Type: application/json\' \\')
    print('  -d \'{"text":"Hello world, this is a test of the edge text to speech system."}\' \\')
    print("  --output test.mp3")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()
