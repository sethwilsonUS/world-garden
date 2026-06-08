import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const shouldBypassClerkMiddleware =
  process.env.LOCAL_MODE === "true" && process.env.NODE_ENV !== "production";

export default shouldBypassClerkMiddleware
  ? () => NextResponse.next()
  : clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
