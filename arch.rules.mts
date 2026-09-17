import {
  createViolation,
  defineCondition,
  definePredicate,
  modules,
  not,
  project,
  resideInFolder,
} from "@nielspeter/ts-archunit";
import { recommended } from "@nielspeter/ts-archunit/presets";

// arch-baseline.json contains reviewed legacy findings from the preset's
// advisory rules. Fix new findings; never regenerate the baseline merely to
// turn a failing architecture check green.
const p = project("tsconfig.arch.json");

type ProjectSourceFile = ReturnType<(typeof p)["getSourceFiles"]>[number];

// Next.js 16.3 made next/cache a mixed entry point: io is documented for
// Client Components, and these legacy helpers have explicit browser shims.
const clientSafeNextCacheExports = new Set([
  "io",
  "unstable_cache",
  "unstable_noStore",
]);

const declaresUseClient = definePredicate<ProjectSourceFile>(
  'declare a "use client" directive',
  (sourceFile) => {
    const directive = sourceFile
      .getStatements()[0]
      ?.getText()
      .replace(/;$/, "");

    return directive === '"use client"' || directive === "'use client'";
  },
);

const useOnlyClientSafeNextCacheExports = defineCondition<ProjectSourceFile>(
  "use only client-safe named exports from next/cache",
  (sourceFiles, context) =>
    sourceFiles.flatMap((sourceFile) => {
      const importViolations = sourceFile
        .getImportDeclarations()
        .filter(
          (declaration) =>
            declaration.getModuleSpecifierValue() === "next/cache" &&
            !declaration.isTypeOnly(),
        )
        .flatMap((declaration) => {
          const namedImports = declaration.getNamedImports();
          const violations = namedImports
            .filter(
              (specifier) =>
                !specifier.isTypeOnly() &&
                !clientSafeNextCacheExports.has(specifier.getName()),
            )
            .map((specifier) =>
              createViolation(
                specifier,
                `server-only next/cache export "${specifier.getName()}" is imported by a client module`,
                context,
              ),
            );

          if (
            namedImports.length === 0 ||
            declaration.getDefaultImport() ||
            declaration.getNamespaceImport()
          ) {
            violations.push(
              createViolation(
                declaration,
                "next/cache must use audited named imports in a client module",
                context,
              ),
            );
          }

          return violations;
        });

      const exportViolations = sourceFile
        .getExportDeclarations()
        .filter(
          (declaration) =>
            declaration.getModuleSpecifierValue() === "next/cache" &&
            !declaration.isTypeOnly(),
        )
        .flatMap((declaration) => {
          const namedExports = declaration.getNamedExports();
          const violations = namedExports
            .filter(
              (specifier) =>
                !specifier.isTypeOnly() &&
                !clientSafeNextCacheExports.has(specifier.getName()),
            )
            .map((specifier) =>
              createViolation(
                specifier,
                `server-only next/cache export "${specifier.getName()}" is re-exported by a client module`,
                context,
              ),
            );

          if (namedExports.length === 0) {
            violations.push(
              createViolation(
                declaration,
                "next/cache must use audited named exports in a client module",
                context,
              ),
            );
          }

          return violations;
        });

      return [...importViolations, ...exportViolations];
    }),
);

const convexMustStayIndependentOfWeb = modules(p)
  .that()
  .resideInFolder("convex/**")
  .and()
  .satisfy(not(resideInFolder("convex/_generated/**")))
  .expectNonEmpty()
  .should()
  .notImportFrom(
    "app/**",
    "components/**",
    "hooks/**",
    "next",
    "next/**",
    "react",
    "react/**",
    "react-dom",
    "react-dom/**",
    "@clerk/nextjs",
    "@clerk/nextjs/**",
    "convex/react",
    "convex/react/**",
  )
  .rule({
    id: "curio/runtime/convex-independent-of-web",
    because:
      "Convex runs outside the Next.js and React runtimes and must remain reusable by every client adapter",
    suggestion:
      "Move platform-neutral behavior behind a small interface in lib, or keep the web-specific implementation in app, components, or hooks",
    imperative:
      "Do NOT import web runtime packages or app, component, or hook modules from Convex production code",
  })
  .asSeverity("error");

const clientModulesMustStayOutOfServerRuntimes = modules(p)
  .that()
  .satisfy(declaresUseClient)
  .expectNonEmpty()
  .should()
  .notImportFromWithOptions(
    [
      "server-only",
      "server-only/**",
      "next/document",
      "next/document/**",
      "next/headers",
      "next/headers/**",
      "next/og",
      "next/og/**",
      "next/root-params",
      "next/root-params/**",
      "next/server",
      "next/server/**",
      "@clerk/nextjs/server",
      "@clerk/nextjs/server/**",
      "convex/server",
      "convex/server/**",
      "convex/nextjs",
      "convex/nextjs/**",
    ],
    { ignoreTypeImports: true },
  )
  .rule({
    id: "curio/runtime/client-independent-of-server",
    because:
      'a module marked "use client" is bundled for the browser and cannot safely depend on server-only runtimes',
    suggestion:
      "Move server work behind a route, Convex function, or server adapter and pass only serializable data through the client interface",
    imperative:
      'Do NOT import server-only Next.js, Clerk, or Convex modules from a "use client" module',
  })
  .asSeverity("error");

const clientModulesMustUseClientSafeNextCacheExports = modules(p)
  .that()
  .satisfy(declaresUseClient)
  .expectNonEmpty()
  .should()
  .satisfy(useOnlyClientSafeNextCacheExports)
  .rule({
    id: "curio/runtime/client-safe-next-cache-exports",
    because:
      "next/cache contains both client-safe and server-only exports in Next.js 16.3",
    suggestion:
      "Use io for client-side request-time values, or move cache invalidation and cache configuration into a server adapter",
    imperative:
      "Do NOT import server-only next/cache exports from a client module",
  })
  .asSeverity("error");

const architectureRules = [
  ...recommended(p, {
    include: "{app,components,hooks,lib,convex}/**/*.{ts,tsx}",
  }),
  convexMustStayIndependentOfWeb,
  clientModulesMustStayOutOfServerRuntimes,
  clientModulesMustUseClientSafeNextCacheExports,
];

export default architectureRules;
