import { modules, not, project, resideInFile } from "@nielspeter/ts-archunit";
import { recommended } from "@nielspeter/ts-archunit/presets";
import { join } from "node:path";

const mobileProject = project("mobile/tsconfig.arch.json");
const webImplementationImports = ["app", "components", "hooks", "lib"].map(
  (folder) =>
    join(import.meta.dirname, "..", folder, "**").replaceAll("\\", "/"),
);
const convexImplementationImports = join(
  import.meta.dirname,
  "..",
  "convex",
  "**",
).replaceAll("\\", "/");

const mobileMustStayIndependentOfWeb = modules(mobileProject)
  .that()
  .resideInFolder("{app,src}/**")
  .and()
  .satisfy(not(resideInFile("**/src/data/convexClientApi.ts")))
  .expectNonEmpty()
  .should()
  .notImportFrom(
    ...webImplementationImports,
    convexImplementationImports,
    "next",
    "next/**",
    "react-dom",
    "react-dom/**",
    "@clerk/nextjs",
    "@clerk/nextjs/**",
    "convex/server",
    "convex/server/**",
    "convex/nextjs",
    "convex/nextjs/**",
  )
  .rule({
    id: "curio/runtime/mobile-independent-of-web",
    because:
      "the Expo application must remain a native adapter instead of pulling browser, generated server declarations, or server implementation across the platform seam",
    suggestion:
      "Move reusable behavior into packages/domain, or implement it behind a mobile-owned adapter",
    imperative:
      "Do NOT import Next.js, React DOM, web or Convex implementation folders, or server-only Convex APIs from mobile code",
  })
  .asSeverity("error");

const convexClientApiMustStayNarrow = modules(mobileProject)
  .that()
  .resideInFile("**/src/data/convexClientApi.ts")
  .expectNonEmpty()
  .should()
  .onlyImportFrom("@curio-garden/domain", "convex/server")
  .rule({
    id: "curio/runtime/mobile-convex-client-api-seam",
    because:
      "the native client needs typed function references without pulling Convex's generated server declaration graph into the mobile project",
    suggestion:
      "Add reviewed client function references to this adapter and keep server implementations outside mobile",
    imperative:
      "Only import domain contracts and Convex's documented function-reference factory from the native client API seam",
  })
  .asSeverity("error");

export default [
  ...recommended(mobileProject, {
    include: "{app,src}/**/*.{ts,tsx}",
  }),
  mobileMustStayIndependentOfWeb,
  convexClientApiMustStayNarrow,
];
