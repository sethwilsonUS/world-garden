import { modules, project } from "@nielspeter/ts-archunit";
import { recommended } from "@nielspeter/ts-archunit/presets";
import { join } from "node:path";

const domainProject = project("packages/domain/tsconfig.arch.json");
const domainSource = join(import.meta.dirname, "src", "**").replaceAll(
  "\\",
  "/",
);

const domainMustStayPlatformNeutral = modules(domainProject)
  .that()
  .resideInFolder("src/**")
  .expectNonEmpty()
  .should()
  .onlyImportFrom(domainSource)
  .rule({
    id: "curio/runtime/domain-platform-neutral",
    because:
      "the shared domain package must run unchanged in native and browser clients",
    suggestion:
      "Keep pure types and behavior here, and move framework or platform access behind an application-owned adapter",
    imperative:
      "Do NOT import external packages or native, browser, server, or framework APIs from packages/domain/src",
  })
  .asSeverity("error");

const architectureRules = [
  ...recommended(domainProject, {
    include: "src/**/*.{ts,tsx,mts,cts}",
  }),
  domainMustStayPlatformNeutral,
];

export default architectureRules;
