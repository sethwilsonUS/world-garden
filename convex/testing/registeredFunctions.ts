import type {
  DefaultFunctionArgs,
  FunctionVisibility,
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery,
} from "convex/server";

const requireObjectLike = (
  registeredFunction: unknown,
  operation: string,
): object => {
  if (
    registeredFunction === null ||
    (typeof registeredFunction !== "object" &&
      typeof registeredFunction !== "function")
  ) {
    throw new TypeError(
      `Cannot ${operation}: the registered Convex function is not an object.`,
    );
  }

  return registeredFunction;
};

type RegisteredHandlerForTest<TArgs, TReturn> = {
  readonly _handler: (ctx: never, args: TArgs) => TReturn;
};

type ConvexRegisteredFunction =
  | RegisteredQuery<FunctionVisibility, DefaultFunctionArgs, unknown>
  | RegisteredMutation<FunctionVisibility, DefaultFunctionArgs, unknown>
  | RegisteredAction<FunctionVisibility, DefaultFunctionArgs, unknown>;

type RegisteredArgs<TRegistered extends ConvexRegisteredFunction> =
  TRegistered extends RegisteredQuery<
    FunctionVisibility,
    infer TArgs,
    unknown
  >
    ? TArgs
    : TRegistered extends RegisteredMutation<
          FunctionVisibility,
          infer TArgs,
          unknown
        >
      ? TArgs
      : TRegistered extends RegisteredAction<
            FunctionVisibility,
            infer TArgs,
            unknown
          >
        ? TArgs
        : never;

type RegisteredReturn<TRegistered extends ConvexRegisteredFunction> =
  TRegistered extends RegisteredQuery<
    FunctionVisibility,
    DefaultFunctionArgs,
    infer TReturn
  >
    ? TReturn
    : TRegistered extends RegisteredMutation<
          FunctionVisibility,
          DefaultFunctionArgs,
          infer TReturn
        >
      ? TReturn
      : TRegistered extends RegisteredAction<
            FunctionVisibility,
            DefaultFunctionArgs,
            infer TReturn
          >
        ? TReturn
        : never;

export function invokeRegistered<TArgs, TReturn>(
  registeredFunction: RegisteredHandlerForTest<TArgs, TReturn>,
  ctx: unknown,
  args: TArgs,
): Promise<Awaited<TReturn>>;
export function invokeRegistered<TRegistered extends ConvexRegisteredFunction>(
  registeredFunction: TRegistered,
  ctx: unknown,
  args: RegisteredArgs<TRegistered>,
): Promise<Awaited<RegisteredReturn<TRegistered>>>;
export function invokeRegistered(
  registeredFunction: unknown,
  ctx: unknown,
  args: unknown,
): Promise<unknown> {
  return invokeRegisteredRuntime(registeredFunction, ctx, args);
}

export function registeredInvoker<TArgs, TReturn>(
  registeredFunction: RegisteredHandlerForTest<TArgs, TReturn>,
): (ctx: unknown, args: TArgs) => Promise<Awaited<TReturn>>;
export function registeredInvoker<
  TRegistered extends ConvexRegisteredFunction,
>(
  registeredFunction: TRegistered,
): (
  ctx: unknown,
  args: RegisteredArgs<TRegistered>,
) => Promise<Awaited<RegisteredReturn<TRegistered>>>;
export function registeredInvoker(
  registeredFunction: unknown,
): (ctx: unknown, args: unknown) => Promise<unknown> {
  return async (ctx, args) =>
    await invokeRegisteredRuntime(registeredFunction, ctx, args);
}

async function invokeRegisteredRuntime(
  registeredFunction: unknown,
  ctx: unknown,
  args: unknown,
): Promise<unknown> {
  const candidate = requireObjectLike(
    registeredFunction,
    "invoke its private handler",
  );
  if (!("_handler" in candidate) || typeof candidate._handler !== "function") {
    throw new TypeError(
      "Cannot invoke the registered Convex function: _handler is not callable.",
    );
  }

  return await candidate._handler.call(candidate, ctx as never, args);
}

export const validatorContractOf = (registeredFunction: unknown) => {
  const candidate = requireObjectLike(
    registeredFunction,
    "inspect its validator contract",
  );
  if (
    !("exportArgs" in candidate) ||
    typeof candidate.exportArgs !== "function" ||
    !("exportReturns" in candidate) ||
    typeof candidate.exportReturns !== "function"
  ) {
    throw new TypeError(
      "Cannot inspect the registered Convex function: validator exporters are not callable.",
    );
  }

  const exportArgs = candidate.exportArgs.bind(candidate);
  const exportReturns = candidate.exportReturns.bind(candidate);
  return {
    exportArgs(): string {
      const value = exportArgs();
      if (typeof value !== "string") {
        throw new TypeError("Convex exportArgs() did not return JSON text.");
      }
      return value;
    },
    exportReturns(): string {
      const value = exportReturns();
      if (typeof value !== "string") {
        throw new TypeError("Convex exportReturns() did not return JSON text.");
      }
      return value;
    },
  };
};
