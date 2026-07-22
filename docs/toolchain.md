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
