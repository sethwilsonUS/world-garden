# Toolchain

Curio Garden treats Node.js as a platform dependency rather than an isolated
npm package. The runtime major must stay aligned across:

- `.nvmrc`, used by local development and GitHub Actions;
- `engines.node` in `package.json`, used by npm and Vercel;
- the installed and declared `@types/node` major.

Run `npm run toolchain:check` to verify that contract. Dependabot may update
`@types/node` within the active major, but major updates are intentionally
ignored because they require a coordinated runtime migration.

Node 24 is the current project runtime because it is an LTS release supported
by [Vercel's Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

## TypeScript 7 transition

[TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
provides the native `tsc` executable but does not provide the programmatic
compiler API consumed by tools such as typescript-eslint. The repository
therefore follows Microsoft's side-by-side migration pattern:

- `@typescript/native` supplies the TypeScript 7 `tsc` executable;
- the `typescript` npm alias supplies the TypeScript 6 API and `tsc6`;
- `npm run typecheck` runs both compiler paths.

Remove the TypeScript 6 alias and the tooling typecheck after TypeScript ships
its new API and both Next.js and typescript-eslint declare support for it.

## ESLint 10 transition

Next.js currently includes plugins that still use APIs removed by ESLint 10.
[ESLint's `@eslint/compat` utility](https://eslint.org/blog/2024/05/eslint-compatibility-utilities/)
adapts those plugin rules in `eslint.config.mjs`. Remove the compatibility
wrapper once the plugins bundled by `eslint-config-next` support ESLint 10
directly.

## Oxlint anti-slop companion

ESLint remains the authoritative framework, accessibility, import, and
TypeScript linter. Oxlint is an additive lane for five repository-appropriate
rules vendored from
[`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop) at a reviewed
commit. The provenance and upstream MIT license live beside the source in
`tools/oxlint/anti-slop/`; the Effect-specific plugin is not included.

The JavaScript-plugin bridge is still alpha, so `oxlint` and
`@oxlint/plugins` are exact-pinned to the same version. Every lint command uses
the project-local Node launcher rather than a standalone Oxlint binary. Before
the project scan, `scripts/verify-anti-slop.mjs` checks the Node 24 runtime,
package pins, suppression policy, and an intentionally failing five-rule
canary. This runtime check is the source of truth because Oxlint's
`--print-config` output does not currently report JavaScript-plugin rules.

The shared root `.oxlintrc.json` applies the same anti-slop policy to web,
Convex, tooling, and mobile source. All built-in Oxlint categories are off;
the companion lane exists only for the explicitly selected anti-slop rules.
