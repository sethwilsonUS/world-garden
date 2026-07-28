import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  assembleAccountDataExport,
  getAccountDataExportFilename,
} from "@/lib/account-data-export";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  Expires: "0",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

const EXPORT_UNAVAILABLE_ERROR =
  "Account data export is temporarily unavailable.";
const AUTH_PHASE_TIMEOUT_MS = 10_000;
const ROUTE_TIMEOUT_MS = 55_000;

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const errorResponse = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: PRIVATE_NO_STORE_HEADERS });

const hasAllowedOrigin = (request: NextRequest): boolean => {
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

  const origin = request.headers.get("origin");
  if (!origin) return fetchSite === "same-origin";

  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
};

type ExportAuthResult =
  | { status: "signed-out" }
  | { status: "unavailable" }
  | {
      status: "ready";
      clerkUser: NonNullable<Awaited<ReturnType<typeof currentUser>>>;
      convexToken: string;
    };

const resolveExportAuth = async (
  signal: AbortSignal,
): Promise<ExportAuthResult> => {
  if (signal.aborted) {
    throw signal.reason ?? new Error("Account export cancelled");
  }
  const session = await auth();
  if (signal.aborted) {
    throw signal.reason ?? new Error("Account export cancelled");
  }
  if (!session.isAuthenticated || !session.userId) {
    return { status: "signed-out" };
  }

  const [convexToken, clerkUser] = await Promise.all([
    session.getToken({ template: "convex" }),
    currentUser(),
  ]);
  if (signal.aborted) {
    throw signal.reason ?? new Error("Account export cancelled");
  }
  if (!convexToken || !clerkUser || clerkUser.id !== session.userId) {
    return { status: "unavailable" };
  }
  return { status: "ready", clerkUser, convexToken };
};

const resolveExportAuthWithDeadline = async (
  routeSignal: AbortSignal,
): Promise<ExportAuthResult> => {
  const controller = new AbortController();
  const abortFromRoute = () => {
    if (!controller.signal.aborted) controller.abort(routeSignal.reason);
  };
  if (routeSignal.aborted) {
    abortFromRoute();
  } else {
    routeSignal.addEventListener("abort", abortFromRoute, { once: true });
  }

  const timeoutId = setTimeout(
    () => controller.abort(new Error("Account export auth timed out")),
    AUTH_PHASE_TIMEOUT_MS,
  );
  let rejectOnAbort: (() => void) | undefined;

  try {
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? new Error("Account export cancelled");
    }
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectOnAbort = () =>
        reject(
          controller.signal.reason ?? new Error("Account export cancelled"),
        );
      controller.signal.addEventListener("abort", rejectOnAbort, {
        once: true,
      });
    });
    const authResolution = Promise.resolve().then(() =>
      resolveExportAuth(controller.signal),
    );
    return await Promise.race([authResolution, cancellation]);
  } finally {
    clearTimeout(timeoutId);
    routeSignal.removeEventListener("abort", abortFromRoute);
    if (rejectOnAbort) {
      controller.signal.removeEventListener("abort", rejectOnAbort);
    }
  }
};

export const POST = async (request: NextRequest) => {
  if (!hasAllowedOrigin(request)) {
    return errorResponse("Request not allowed", 403);
  }

  const routeController = new AbortController();
  const abortFromRequest = () => {
    if (!routeController.signal.aborted) {
      routeController.abort(request.signal.reason);
    }
  };
  if (request.signal.aborted) {
    abortFromRequest();
  } else {
    request.signal.addEventListener("abort", abortFromRequest, { once: true });
  }
  const routeTimeoutId = setTimeout(
    () => routeController.abort(new Error("Account export route timed out")),
    ROUTE_TIMEOUT_MS,
  );

  try {
    const exportAuth = await resolveExportAuthWithDeadline(
      routeController.signal,
    );
    if (exportAuth.status === "signed-out") {
      return errorResponse("Authentication required", 401);
    }
    if (exportAuth.status === "unavailable") {
      return errorResponse(EXPORT_UNAVAILABLE_ERROR, 503);
    }

    const exportedAt = new Date();
    const manifest = await assembleAccountDataExport({
      clerkUser: exportAuth.clerkUser,
      convexToken: exportAuth.convexToken,
      exportedAt,
      signal: routeController.signal,
    });
    const filename = getAccountDataExportFilename(exportedAt);

    return new Response(`${JSON.stringify(manifest, null, 2)}\n`, {
      status: 200,
      headers: {
        ...PRIVATE_NO_STORE_HEADERS,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch {
    console.error("[/api/account/export] Account export failed");
    return errorResponse(EXPORT_UNAVAILABLE_ERROR, 503);
  } finally {
    clearTimeout(routeTimeoutId);
    request.signal.removeEventListener("abort", abortFromRequest);
  }
};
