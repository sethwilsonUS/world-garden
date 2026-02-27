/**
 * Local-dev-only Edge TTS route.
 *
 * On Vercel, /api/tts is handled by the Python function at _python/tts.py.
 * This Node.js route exists so `next dev` works without the Vercel CLI.
 * It shells out to the Python edge-tts package installed in a local venv.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";

const DEFAULT_VOICE = "en-US-AriaNeural";

const VOICE_RE = /^[a-z]{2,3}-[A-Z]{2}(-[A-Za-z]+)*Neural$/;

const PYTHON_PATH =
  process.env.EDGE_TTS_PYTHON_PATH ?? "/tmp/edge-tts-venv/bin/python3";

const PYTHON_SCRIPT = `
import asyncio, json, sys, edge_tts

async def main():
    req = json.loads(sys.stdin.read())
    communicate = edge_tts.Communicate(req["text"], req["voice"])
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            sys.stdout.buffer.write(chunk["data"])

asyncio.run(main())
`;

const generateWithEdgeTts = (
  text: string,
  voice: string,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_PATH, ["-c", PYTHON_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => chunks.push(data));
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `edge-tts exited with code ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    proc.on("error", reject);

    proc.stdin.write(JSON.stringify({ text, voice }));
    proc.stdin.end();
  });

export const POST = async (req: NextRequest) => {
  try {
    const { text, voiceId } = (await req.json()) as {
      text: string;
      voiceId?: string;
    };

    if (!text || text.length < 10) {
      return NextResponse.json(
        { error: "Text is too short to generate audio" },
        { status: 400 },
      );
    }

    const voice = voiceId && VOICE_RE.test(voiceId) ? voiceId : DEFAULT_VOICE;

    const audioBuffer = await generateWithEdgeTts(text, voice);

    if (audioBuffer.length === 0) {
      return NextResponse.json(
        { error: "No audio was generated" },
        { status: 500 },
      );
    }

    return new NextResponse(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioBuffer.length),
      },
    });
  } catch (err) {
    console.error("Edge TTS generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Audio generation failed" },
      { status: 500 },
    );
  }
};
