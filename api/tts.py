"""Vercel Python serverless function for Edge TTS audio generation.

In production, Vercel routes /api/tts to this Python function.
For local development, the Next.js route at app/api/tts/route.ts
handles the same endpoint via child_process.spawn.
"""

import asyncio
import json
import re
from http.server import BaseHTTPRequestHandler

import edge_tts

DEFAULT_VOICE = "en-US-AriaNeural"

# Voice IDs follow a strict locale-name pattern, e.g. "en-US-AriaNeural".
# Validating format prevents misuse without needing an exhaustive allowlist
# (Microsoft adds new voices regularly).
_VOICE_RE = re.compile(r"^[a-z]{2,3}-[A-Z]{2}(-[A-Za-z]+)*Neural$")


async def _generate(text: str, voice: str) -> bytes:
    communicate = edge_tts.Communicate(text, voice)
    chunks: list[bytes] = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            chunks.append(chunk["data"])
    return b"".join(chunks)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except (json.JSONDecodeError, ValueError):
            self._json(400, {"error": "Invalid JSON body"})
            return

        text = body.get("text", "")
        voice_id = body.get("voiceId", DEFAULT_VOICE)

        if not text or len(text) < 10:
            self._json(400, {"error": "Text is too short to generate audio"})
            return

        if not _VOICE_RE.match(voice_id):
            voice_id = DEFAULT_VOICE

        try:
            audio = asyncio.run(_generate(text, voice_id))
        except Exception as exc:
            self._json(500, {"error": str(exc)})
            return

        if not audio:
            self._json(500, {"error": "No audio was generated"})
            return

        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)

    def _json(self, status: int, data: dict) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
