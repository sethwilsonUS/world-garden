<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Production vs. Local Mode Architecture Guardrails

- **Never opt routes under `app/(app)/` or routes importing `convex/nextjs` into static or ISR prerendering.**
  - In production, `app/(app)/layout.tsx` wraps routes in `<ClerkProvider dynamic>`, and `convex/nextjs` (`fetchQuery`, `fetchMutation`, `fetchAction`) hardcodes `cache: "no-store"` (`revalidate: 0`).
  - Exporting `generateStaticParams`, a non-zero `revalidate`, or `dynamic = "force-static"` / `"error"` on these routes causes Next.js to throw `DYNAMIC_SERVER_USAGE` (HTTP 500) on Vercel — even though `LOCAL_MODE=true` builds and Playwright tests pass because local mode disables both Clerk and Convex SSR reads.
  - Export `export const dynamic = "force-dynamic"` on server pages and static-by-default metadata routes (`app/sitemap.ts`, `robots.ts`, `manifest.ts`) that read from Convex or sit under `app/(app)/`, and rely on Convex snapshots plus explicit `Cache-Control` headers on API routes for caching.
  - Enforced automatically by `curio/runtime/no-static-isr-with-dynamic-runtimes` in `arch.rules.mts` (`npm run arch`).
- **Verify SSR, auth, middleware, and Convex changes on the Vercel Preview deployment before merging.**
  - Local `npm run build` and CI Playwright smoke tests run with `LOCAL_MODE=true` / `NEXT_PUBLIC_LOCAL_MODE=true`, which intentionally skips Clerk middleware and Convex queries. Whenever a PR changes Next.js route segment config, server-side Convex reads, metadata routes, or auth wiring, hit the affected URLs on the PR's Vercel Preview deployment before merging to `main`.
