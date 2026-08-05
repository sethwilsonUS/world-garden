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
const nativeAuthTransportBindingImport = join(
  import.meta.dirname,
  "src",
  "auth",
  "NativeAuthTransportBindingContext.tsx",
).replaceAll("\\", "/");
const nativeLibraryPersistenceImports = [
  "@react-native-async-storage/async-storage",
  "@react-native-async-storage/async-storage/**",
  "@react-native-community/netinfo",
  "@react-native-community/netinfo/**",
  "expo-file-system",
  "expo-file-system/**",
  "expo-media-library",
  "expo-media-library/**",
  "expo-secure-store",
  "expo-secure-store/**",
  "expo-sqlite",
  "expo-sqlite/**",
  "react-native-blob-util",
  "react-native-blob-util/**",
  "react-native-fs",
  "react-native-fs/**",
];

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

const nativeOfflinePersistenceMustStayDeferred = modules(mobileProject)
  .that()
  .resideInFolder("{app,src}/**")
  .expectNonEmpty()
  .should()
  .notImportFrom(...nativeLibraryPersistenceImports)
  .rule({
    id: "curio/runtime/native-offline-persistence-deferred",
    because:
      "the current native product has no guest storage, offline cache, download system, or device-backed Library",
    suggestion:
      "Keep private state behind reviewed online adapters; design offline article and media storage as a separate future capability",
    imperative:
      "Do NOT add filesystem, database, device storage, connectivity, or download-library imports anywhere in the current native product",
  })
  .asSeverity("error");

const nativeAuthTransportBindingMustStayPrivate = modules(mobileProject)
  .that()
  .resideInFolder("{app,src}/**")
  .and()
  .satisfy(not(resideInFile("src/auth/NativeAuthContext.tsx")))
  .and()
  .satisfy(not(resideInFile("src/data/ConvexNativeLibraryProvider.tsx")))
  .expectNonEmpty()
  .should()
  .notImportFrom(nativeAuthTransportBindingImport)
  .rule({
    id: "curio/privacy/native-auth-transport-binding-private",
    because:
      "the raw validated account subject exists only to bind queued native transport to the account that initiated it",
    suggestion:
      "Use the profile-only NativeAuthContext from UI; consume the transport binding only inside an audited data adapter",
    imperative:
      "Do NOT import the native auth transport binding into routes, screens, components, or non-audited adapters",
  })
  .asSeverity("error");

export default [
  ...recommended(mobileProject, {
    include: "{app,src}/**/*.{ts,tsx}",
  }),
  mobileMustStayIndependentOfWeb,
  convexClientApiMustStayNarrow,
  nativeOfflinePersistenceMustStayDeferred,
  nativeAuthTransportBindingMustStayPrivate,
];
