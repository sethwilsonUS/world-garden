import {
  createViolation,
  defineCondition,
  modules,
  not,
  project,
  resideInFile,
} from "@nielspeter/ts-archunit";
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
const nativeAccountSubjectBindingImport = join(
  import.meta.dirname,
  "src",
  "auth",
  "NativeAccountSubjectBindingContext.tsx",
).replaceAll("\\", "/");
const nativeArticleAudioAccessProviderImport = join(
  import.meta.dirname,
  "src",
  "media",
  "NativeArticleAudioAccessProvider.tsx",
).replaceAll("\\", "/");
const nativeArticleAudioEphemeralStoreFile =
  "src/media/NativeArticleAudioEphemeralStore.ts";
const nativePlaybackRatePreferenceStoreFile =
  "src/media/NativePlaybackRatePreferenceStore.ts";
const nativePlaybackRateImport = join(
  import.meta.dirname,
  "src",
  "media",
  "NativePlaybackRate.ts",
).replaceAll("\\", "/");
const expoBackgroundAudioRuntimeFile =
  "src/media/ExpoBackgroundAudioRuntime.ts";
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
const nativePushImports = [
  "@notifee/react-native",
  "@notifee/react-native/**",
  "@react-native-firebase/messaging",
  "@react-native-firebase/messaging/**",
  "expo-notifications",
  "expo-notifications/**",
  "react-native-notifications",
  "react-native-notifications/**",
  "react-native-onesignal",
  "react-native-onesignal/**",
  "react-native-push-notification",
  "react-native-push-notification/**",
];

type MobileProjectSourceFile = ReturnType<
  (typeof mobileProject)["getSourceFiles"]
>[number];

const useOnlyPublicDomainPackageImports =
  defineCondition<MobileProjectSourceFile>(
    "use only the public @curio-garden/domain package interface",
    (sourceFiles, context) =>
      sourceFiles.flatMap((sourceFile) =>
        [
          ...sourceFile.getImportDeclarations(),
          ...sourceFile.getExportDeclarations(),
        ]
          .filter((declaration) =>
            /(?:^|\/)packages\/domain\/src(?:\/|$)/u.test(
              declaration.getModuleSpecifierValue() ?? "",
            ),
          )
          .map((declaration) =>
            createViolation(
              declaration,
              "native domain consumer bypasses the public @curio-garden/domain package interface",
              context,
            ),
          ),
      ),
  );

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

const mobileDomainConsumersMustUseThePublicPackageInterface = modules(
  mobileProject,
)
  .that()
  .resideInFolder("{app,src}/**")
  .expectNonEmpty()
  .should()
  .satisfy(useOnlyPublicDomainPackageImports)
  .rule({
    id: "curio/domain/mobile-public-package-interface",
    because:
      "native domain consumers must remain behind the same reviewed package interface as web and Convex",
    suggestion:
      'Import shared values from "@curio-garden/domain" and export newly earned seams from packages/domain/src/index.ts',
    imperative:
      "Do NOT import packages/domain/src implementation files from the native application",
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
  .and()
  .satisfy(not(resideInFile(nativeArticleAudioEphemeralStoreFile)))
  .and()
  .satisfy(not(resideInFile(nativePlaybackRatePreferenceStoreFile)))
  .expectNonEmpty()
  .should()
  .notImportFrom(...nativeLibraryPersistenceImports)
  .rule({
    id: "curio/runtime/native-offline-persistence-deferred",
    because:
      "the current native product has no guest storage, offline article cache, download system, or device-backed Library; its only reviewed device-storage seams are a bounded disposable audio handoff and one scalar playback-speed preference",
    suggestion:
      "Keep private state behind reviewed online adapters; use NativeArticleAudioEphemeralStore only for active-playback leases, NativePlaybackRatePreferenceStore only for its bounded scalar preference, and design offline article or media storage separately",
    imperative:
      "Do NOT add filesystem, database, device storage, connectivity, or download-library imports outside the two exact reviewed storage seams",
  })
  .asSeverity("error");

const nativeArticleAudioEphemeralStoreMustStayNarrow = modules(mobileProject)
  .that()
  .resideInFile(nativeArticleAudioEphemeralStoreFile)
  .expectNonEmpty()
  .should()
  .onlyImportFrom(
    "expo-crypto",
    "expo-crypto/**",
    "expo-file-system",
    "expo-file-system/**",
  )
  .rule({
    id: "curio/runtime/native-audio-ephemeral-store-narrow",
    because:
      "active playback needs one bounded cache-file handoff, but that file must never become an offline or durable media store",
    suggestion:
      "Keep randomized naming and cache-file lifecycle inside this adapter; expose only short-lived leases that delete their file on release",
    imperative:
      "Only import Expo crypto and filesystem APIs from the dedicated native article-audio ephemeral store",
  })
  .asSeverity("error");

const nativePlaybackRatePreferenceStoreMustStayNarrow = modules(mobileProject)
  .that()
  .resideInFile(nativePlaybackRatePreferenceStoreFile)
  .expectNonEmpty()
  .should()
  .onlyImportFrom(
    "expo-secure-store",
    "expo-secure-store/**",
    nativePlaybackRateImport,
  )
  .rule({
    id: "curio/runtime/native-playback-rate-preference-store-narrow",
    because:
      "playback speed is one non-sensitive device preference and must not become a general content, account, progress, or offline store",
    suggestion:
      "Keep exact rate validation in NativePlaybackRate and expose only load and save for the bounded scalar preference",
    imperative:
      "Only import Expo SecureStore and the pure playback-rate model from the dedicated preference store",
  })
  .asSeverity("error");

const nativeAudioRuntimeImportsMustStayIsolated = modules(mobileProject)
  .that()
  .resideInFolder("{app,src}/**")
  .and()
  .satisfy(not(resideInFile(expoBackgroundAudioRuntimeFile)))
  .expectNonEmpty()
  .should()
  .notImportFrom("expo-audio", "expo-audio/**")
  .rule({
    id: "curio/runtime/native-audio-runtime-isolated",
    because:
      "background playback policy must be enforced at one reviewed native-library boundary",
    suggestion:
      "Depend on the tokenless background audio contract and keep Expo player creation inside ExpoBackgroundAudioRuntime",
    imperative:
      "Do NOT import expo-audio outside the dedicated background audio runtime",
  })
  .asSeverity("error");

const expoBackgroundAudioRuntimeMustStayNarrow = modules(mobileProject)
  .that()
  .resideInFile(expoBackgroundAudioRuntimeFile)
  .expectNonEmpty()
  .should()
  .onlyImportFrom("expo-audio", "expo-audio/**")
  .rule({
    id: "curio/runtime/native-audio-runtime-narrow",
    because:
      "the Expo player boundary must remain a small background-playback adapter rather than absorbing transport, storage, or UI responsibilities",
    suggestion:
      "Keep lifecycle and player-mode translation here; place transport, cache leases, and rendering behind their existing seams",
    imperative:
      "Only import expo-audio from the dedicated background audio runtime",
  })
  .asSeverity("error");

const nativePushMustStayDeferred = modules(mobileProject)
  .that()
  .resideInFolder("{app,src}/**")
  .expectNonEmpty()
  .should()
  .notImportFrom(...nativePushImports)
  .rule({
    id: "curio/runtime/native-push-deferred",
    because:
      "background media controls use the operating system media session and must not silently introduce the separately deferred push-notification product",
    suggestion:
      "Keep playback behind ExpoBackgroundAudioRuntime; design push permissions, credentials, delivery, and user controls as a separate future capability",
    imperative:
      "Do NOT import push-notification SDKs into the native application",
  })
  .asSeverity("error");

const nativeAuthTransportBindingMustStayPrivate = modules(mobileProject)
  .that()
  .resideInFolder("{app,src}/**")
  .and()
  .satisfy(not(resideInFile("src/auth/NativeAuthContext.tsx")))
  .and()
  .satisfy(not(resideInFile("src/media/NativeArticleAudioAccessProvider.tsx")))
  .expectNonEmpty()
  .should()
  .notImportFrom(nativeAuthTransportBindingImport)
  .rule({
    id: "curio/privacy/native-auth-transport-binding-private",
    because:
      "ephemeral credentials exist only to bind audited native transport to the account that initiated it",
    suggestion:
      "Use tokenless public contexts from UI; consume the private binding only inside an audited transport adapter",
    imperative:
      "Do NOT import the native auth transport binding into routes, screens, components, or non-audited adapters",
  })
  .asSeverity("error");

const nativeAccountSubjectBindingMustStayPrivate = modules(mobileProject)
  .that()
  .resideInFolder("{app,src}/**")
  .and()
  .satisfy(not(resideInFile("src/auth/NativeAuthContext.tsx")))
  .and()
  .satisfy(not(resideInFile("src/data/ConvexNativeLibraryProvider.tsx")))
  .expectNonEmpty()
  .should()
  .notImportFrom(nativeAccountSubjectBindingImport)
  .rule({
    id: "curio/privacy/native-account-subject-binding-private",
    because:
      "the validated Clerk-to-Convex subject is private account correlation data for the Library adapter, not UI state",
    suggestion:
      "Consume tokenless feature contexts from routes and screens; keep raw account correlation inside audited adapters",
    imperative:
      "Do NOT import the native account-subject binding outside NativeAuthContext or ConvexNativeLibraryProvider",
  })
  .asSeverity("error");

const nativeArticleAudioAccessProviderMustStayPrivate = modules(mobileProject)
  .that()
  .resideInFolder("{app,src}/**")
  .and()
  .satisfy(not(resideInFile("src/providers/NativeDataAuthProvider.tsx")))
  .expectNonEmpty()
  .should()
  .notImportFrom(nativeArticleAudioAccessProviderImport)
  .rule({
    id: "curio/privacy/native-article-audio-provider-private",
    because:
      "the provider resolves Clerk credentials and attaches Authorization headers while its separate public context remains tokenless",
    suggestion:
      "Import NativeArticleAudioAccessContext from callers and compose the credential-bearing provider only in NativeDataAuthProvider",
    imperative:
      "Do NOT import the credential-bearing article-audio provider outside the reviewed native provider graph",
  })
  .asSeverity("error");

export default [
  ...recommended(mobileProject, {
    include: "{app,src}/**/*.{ts,tsx}",
  }),
  mobileMustStayIndependentOfWeb,
  mobileDomainConsumersMustUseThePublicPackageInterface,
  convexClientApiMustStayNarrow,
  nativeOfflinePersistenceMustStayDeferred,
  nativeArticleAudioEphemeralStoreMustStayNarrow,
  nativePlaybackRatePreferenceStoreMustStayNarrow,
  nativeAudioRuntimeImportsMustStayIsolated,
  expoBackgroundAudioRuntimeMustStayNarrow,
  nativePushMustStayDeferred,
  nativeAuthTransportBindingMustStayPrivate,
  nativeAccountSubjectBindingMustStayPrivate,
  nativeArticleAudioAccessProviderMustStayPrivate,
];
