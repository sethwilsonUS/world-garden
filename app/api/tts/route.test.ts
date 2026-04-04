import { EventEmitter } from "events";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("child_process", () => ({
  spawn: spawnMock,
}));

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: {
    end: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
  };
  kill: ReturnType<typeof vi.fn>;
};

const createMockProcess = (): MockChildProcess => {
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };
  proc.kill = vi.fn();
  return proc;
};

describe("POST /api/tts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns a complete mp3 payload assembled from child process chunks", async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const { POST } = await import("./route");
    const responsePromise = POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    process.nextTick(() => {
      proc.stdout.emit("data", Buffer.from([0xff, 0xfb, 0x90]));
      proc.stdout.emit("data", Buffer.from([0x64, 0x01, 0x02]));
      proc.emit("close", 0);
    });

    const response = await responsePromise;
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Content-Length")).toBe("6");
    expect(Array.from(bytes)).toEqual([0xff, 0xfb, 0x90, 0x64, 0x01, 0x02]);
    expect(proc.stdin.write).toHaveBeenCalledWith(
      JSON.stringify({
        text: "This article section text is comfortably long enough.",
        voice: "en-US-AriaNeural",
      }),
    );
    expect(proc.stdin.end).toHaveBeenCalledTimes(1);
  });

  it("returns a 500 when edge-tts produces no audio bytes", async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const { POST } = await import("./route");
    const responsePromise = POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
        }),
      }),
    );

    process.nextTick(() => {
      proc.emit("close", 0);
    });

    const response = await responsePromise;

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "No audio was generated",
    });
  });
});
