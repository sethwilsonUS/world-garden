import {
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

const architectureRules = [
  ...recommended(p, {
    include: "{app,components,hooks,lib,convex}/**/*.{ts,tsx}",
  }),
  convexMustStayIndependentOfWeb,
  clientModulesMustStayOutOfServerRuntimes,
];

export default architectureRules;
