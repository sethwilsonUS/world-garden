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

const transitivelyImportsConvexNextjs = (
  root: ProjectSourceFile,
  visited = new Set<string>(),
): boolean => {
  const filePath = root.getFilePath();
  if (visited.has(filePath)) return false;
  visited.add(filePath);

  for (const declaration of root.getImportDeclarations()) {
    if (declaration.isTypeOnly()) continue;
    const specifier = declaration.getModuleSpecifierValue();
    if (
      specifier === "convex/nextjs" ||
      specifier.startsWith("convex/nextjs/")
    ) {
      return true;
    }
    const target = declaration.getModuleSpecifierSourceFile();
    if (target && transitivelyImportsConvexNextjs(target, visited)) {
      return true;
    }
  }

  for (const declaration of root.getExportDeclarations()) {
    if (declaration.isTypeOnly()) continue;
    const specifier = declaration.getModuleSpecifierValue();
    if (
      specifier &&
      (specifier === "convex/nextjs" || specifier.startsWith("convex/nextjs/"))
    ) {
      return true;
    }
    const target = declaration.getModuleSpecifierSourceFile();
    if (target && transitivelyImportsConvexNextjs(target, visited)) {
      return true;
    }
  }

  for (const literal of root.getImportStringLiterals()) {
    const parent = literal.getParent();
    if (!parent || parent.getKindName() !== "CallExpression") continue;
    const specifier = literal.getLiteralValue();
    if (
      specifier === "convex/nextjs" ||
      specifier.startsWith("convex/nextjs/")
    ) {
      return true;
    }
    const symbol = literal.getSymbol();
    const target =
      symbol?.getValueDeclaration()?.getSourceFile() ??
      symbol?.getDeclarations()?.[0]?.getSourceFile();
    if (
      target &&
      !target.isInNodeModules() &&
      transitivelyImportsConvexNextjs(target, visited)
    ) {
      return true;
    }
  }

  return false;
};

const getExportedInitializerText = (
  sourceFile: ProjectSourceFile,
  exportName: string,
): { node: ProjectSourceFile | ReturnType<ProjectSourceFile["getVariableStatements"]>[number]; text: string } | null => {
  for (const statement of sourceFile.getVariableStatements()) {
    if (!statement.isExported()) continue;
    for (const declaration of statement.getDeclarations()) {
      if (declaration.getName() !== exportName) continue;
      return {
        node: statement,
        text: declaration.getInitializer()?.getText().trim() ?? "",
      };
    }
  }
  return null;
};

const getExportedGenerateStaticParamsNode = (sourceFile: ProjectSourceFile) => {
  for (const fn of sourceFile.getFunctions()) {
    if (fn.isExported() && fn.getName() === "generateStaticParams") {
      return fn;
    }
  }

  const variableExport = getExportedInitializerText(
    sourceFile,
    "generateStaticParams",
  );
  if (variableExport) {
    return variableExport.node;
  }

  for (const declaration of sourceFile.getExportDeclarations()) {
    if (declaration.isTypeOnly()) continue;
    for (const specifier of declaration.getNamedExports()) {
      if (specifier.isTypeOnly()) continue;
      const exportedName =
        specifier.getAliasNode()?.getText() ?? specifier.getName();
      if (exportedName === "generateStaticParams") {
        return specifier;
      }
    }
    if (
      declaration.getNamedExports().length === 0 &&
      !declaration.getNamespaceExport()
    ) {
      const target = declaration.getModuleSpecifierSourceFile();
      if (target?.getExportedDeclarations().has("generateStaticParams")) {
        return declaration;
      }
    }
  }

  return null;
};

const stayCompatibleWithProductionDynamicRuntimes =
  defineCondition<ProjectSourceFile>(
    "not opt into static/ISR rendering when under Clerk dynamic layout or importing convex/nextjs",
    (sourceFiles, context) =>
      sourceFiles.flatMap((sourceFile) => {
        const normalizedPath = sourceFile.getFilePath().replace(/\\/gu, "/");
        const isUnderClerkAppLayout = normalizedPath.includes("/app/(app)/");
        const usesConvexNextjs = transitivelyImportsConvexNextjs(sourceFile);

        if (!isUnderClerkAppLayout && !usesConvexNextjs) {
          return [];
        }

        const dynamicExport = getExportedInitializerText(sourceFile, "dynamic");
        const isForceDynamic =
          dynamicExport?.text === '"force-dynamic"' ||
          dynamicExport?.text === "'force-dynamic'";
        const isForceStaticOrError =
          dynamicExport?.text === '"force-static"' ||
          dynamicExport?.text === "'force-static'" ||
          dynamicExport?.text === '"error"' ||
          dynamicExport?.text === "'error'";
        const revalidateExport = getExportedInitializerText(
          sourceFile,
          "revalidate",
        );
        const hasStaticRevalidate =
          revalidateExport !== null && revalidateExport.text !== "0";
        const generateStaticParamsNode =
          getExportedGenerateStaticParamsNode(sourceFile);

        const reasons: string[] = [];
        if (isUnderClerkAppLayout) {
          reasons.push("resides under app/(app)/layout.tsx (<ClerkProvider dynamic>)");
        }
        if (usesConvexNextjs) {
          reasons.push('imports convex/nextjs (which forces cache: "no-store")');
        }
        const reasonSummary = reasons.join(" and ");

        const violations = [];
        if (isForceStaticOrError && dynamicExport) {
          violations.push(
            createViolation(
              dynamicExport.node,
              `exports dynamic = ${dynamicExport.text} while the route ${reasonSummary}; production renders fail with DYNAMIC_SERVER_USAGE`,
              context,
            ),
          );
        }
        if (generateStaticParamsNode) {
          violations.push(
            createViolation(
              generateStaticParamsNode,
              `exports generateStaticParams while the route ${reasonSummary}; production renders fail with DYNAMIC_SERVER_USAGE`,
              context,
            ),
          );
        }
        if (hasStaticRevalidate && !isForceDynamic) {
          violations.push(
            createViolation(
              revalidateExport.node,
              `exports revalidate = ${revalidateExport.text} without dynamic = "force-dynamic" while the route ${reasonSummary}; production renders fail with DYNAMIC_SERVER_USAGE`,
              context,
            ),
          );
        }

        const isStaticByDefaultMetadataRoute =
          /\/app\/(?:.*\/)?(?:sitemap|robots|manifest)\.(?:ts|tsx)$/u.test(
            normalizedPath,
          );
        if (
          isStaticByDefaultMetadataRoute &&
          usesConvexNextjs &&
          !isForceDynamic &&
          !hasStaticRevalidate
        ) {
          violations.push(
            createViolation(
              sourceFile,
              'metadata route imports convex/nextjs without exporting dynamic = "force-dynamic"; Next.js caches metadata routes statically by default and fails with DYNAMIC_SERVER_USAGE',
              context,
            ),
          );
        }

        return violations;
      }),
  );

const appRoutesMustStayCompatibleWithProductionDynamicRuntimes = modules(p)
  .that()
  .resideInFolder("app/**")
  .expectNonEmpty()
  .should()
  .satisfy(stayCompatibleWithProductionDynamicRuntimes)
  .rule({
    id: "curio/runtime/no-static-isr-with-dynamic-runtimes",
    because:
      'app/(app)/layout.tsx wraps production renders in <ClerkProvider dynamic>, and convex/nextjs fetchQuery hardcodes cache: "no-store"; both throw DYNAMIC_SERVER_USAGE (HTTP 500) on static/ISR routes even when LOCAL_MODE=true builds pass',
    suggestion:
      'Export `export const dynamic = "force-dynamic"` instead of `generateStaticParams` or a non-zero `revalidate`, and rely on Convex snapshots plus API Cache-Control headers for caching',
    imperative:
      "Do NOT opt routes under app/(app)/ or routes importing convex/nextjs into static or ISR prerendering",
  })
  .asSeverity("error");

const architectureRules = [
  ...recommended(p, {
    include: "{app,components,hooks,lib,convex}/**/*.{ts,tsx}",
  }),
  convexMustStayIndependentOfWeb,
  clientModulesMustStayOutOfServerRuntimes,
  clientModulesMustUseClientSafeNextCacheExports,
  appRoutesMustStayCompatibleWithProductionDynamicRuntimes,
];

export default architectureRules;
