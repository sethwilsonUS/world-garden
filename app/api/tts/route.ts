/**
 * Local-dev-only Edge TTS route.
 *
 * On Vercel, /api/tts is handled by the Python function at _python/tts.py.
 * This Node.js route exists so `next dev` works without the Vercel CLI.
 * It shells out to the Python edge-tts package installed in a local venv.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import {
  TTS_MIN_TEXT_LENGTH,
  getServerTtsMaxWordsPerRequest,
} from "@/lib/tts-contract";

const DEFAULT_VOICE = "en-US-AriaNeural";

const VOICE_RE = /^[a-z]{2,3}-[A-Z]{2}(-[A-Za-z]+)*Neural$/;

const PYTHON_PATH =
  process.env.EDGE_TTS_PYTHON_PATH ??
  path.join(process.cwd(), ".edge-tts-venv", "bin", "python3");

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

const countWords = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

const generateWithEdgeTtsStream = (
  text: string,
  voice: string,
): ReadableStream<Uint8Array> => {
  let proc: ReturnType<typeof spawn> | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      proc = spawn(PYTHON_PATH, ["-c", PYTHON_SCRIPT], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      if (!proc.stdout || !proc.stderr || !proc.stdin) {
        controller.error(new Error("edge-tts process streams were unavailable"));
        proc.kill();
        return;
      }

      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        controller.enqueue(new Uint8Array(data));
      });
      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          controller.close();
          return;
        }

        controller.error(
          new Error(stderr.trim() || `edge-tts exited with code ${code}`),
        );
      });

      proc.on("error", (error) => {
        controller.error(error);
      });

      proc.stdin.write(JSON.stringify({ text, voice }));
      proc.stdin.end();
    },
    cancel() {
      proc?.kill();
    },
  });
};

export const POST = async (req: NextRequest) => {
  try {
    const { text, voiceId } = (await req.json()) as {
      text: string;
      voiceId?: string;
    };

    if (!text || text.length < TTS_MIN_TEXT_LENGTH) {
      return NextResponse.json(
        { error: "Text is too short to generate audio" },
        { status: 400 },
      );
    }

    const maxWordsPerRequest = getServerTtsMaxWordsPerRequest();

    if (countWords(text) > maxWordsPerRequest) {
      return NextResponse.json(
        {
          error: `Text exceeds ${maxWordsPerRequest} words; split it into smaller chunks before requesting TTS`,
        },
        { status: 400 },
      );
    }

    const voice = voiceId && VOICE_RE.test(voiceId) ? voiceId : DEFAULT_VOICE;

    const audioStream = generateWithEdgeTtsStream(text, voice);

    return new NextResponse(audioStream, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
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
