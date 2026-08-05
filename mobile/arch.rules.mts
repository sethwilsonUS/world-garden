import { modules, project } from "@nielspeter/ts-archunit";
import { recommended } from "@nielspeter/ts-archunit/presets";

const mobileProject = project("mobile/tsconfig.arch.json");

const mobileMustStayIndependentOfWeb = modules(mobileProject)
  .that()
  .resideInFolder("{app,src}/**")
  .expectNonEmpty()
  .should()
  .notImportFrom(
    "../app/**",
    "../components/**",
    "../hooks/**",
    "../lib/**",
    "next",
    "next/**",
    "react-dom",
    "react-dom/**",
    "@clerk/nextjs",
    "@clerk/nextjs/**",
    "convex/server",
    "convex/server/**",
  )
  .rule({
    id: "curio/runtime/mobile-independent-of-web",
    because:
      "the Expo application must remain a native adapter instead of pulling browser or server implementation across the platform seam",
    suggestion:
      "Move reusable behavior into packages/domain, or implement it behind a mobile-owned adapter",
    imperative:
      "Do NOT import Next.js, React DOM, web implementation folders, or server-only Convex APIs from mobile code",
  })
  .asSeverity("error");

export default [
  ...recommended(mobileProject, {
    include: "{app,src}/**/*.{ts,tsx}",
  }),
  mobileMustStayIndependentOfWeb,
];
