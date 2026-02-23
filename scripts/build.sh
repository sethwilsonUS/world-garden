#!/usr/bin/env bash
# Build script that handles Vercel production, preview, and local builds.
#
# - Production (VERCEL_ENV=production): deploys Convex functions to prod, then builds Next.js
# - Preview   (VERCEL_ENV=preview):    creates an isolated Convex preview deployment per branch
# - Local     (no VERCEL_ENV):         just builds Next.js (Convex dev server handles functions)

set -euo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "▸ Production build — deploying Convex functions + Next.js"
  npx convex deploy --cmd 'next build'

elif [ "${VERCEL_ENV:-}" = "preview" ]; then
  BRANCH="${VERCEL_GIT_COMMIT_REF:-preview}"
  echo "▸ Preview build — deploying Convex preview ($BRANCH) + Next.js"
  npx convex deploy --cmd 'next build' --preview-name "$BRANCH"

else
  echo "▸ Local build — Next.js only"
  next build
fi
