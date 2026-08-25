import type {
  ApiFromModules,
  DefaultFunctionArgs,
  FunctionVisibility,
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery,
} from "convex/server";

type RegisteredFunctionExport =
  | RegisteredAction<FunctionVisibility, DefaultFunctionArgs, never>
  | RegisteredMutation<FunctionVisibility, DefaultFunctionArgs, never>
  | RegisteredQuery<FunctionVisibility, DefaultFunctionArgs, never>;

type SingleFunctionModule<RegisteredExport extends RegisteredFunctionExport> = {
  derivedReference: {
    registeredExport: RegisteredExport;
  };
};

/**
 * Derive one function reference through Convex's public API-module mapper.
 *
 * Convex uses `FunctionReferenceFromExport` inside `ApiFromModules`, but does
 * not currently re-export that helper from `convex/server`.
 */
export type FunctionReferenceFromExport<
  RegisteredExport extends RegisteredFunctionExport,
> = ApiFromModules<SingleFunctionModule<RegisteredExport>> extends {
  derivedReference: { registeredExport: infer Reference };
}
  ? Reference
  : never;
