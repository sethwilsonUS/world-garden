import { describe, expect, expectTypeOf, it } from "vitest";

import {
  invokeRegistered,
  validatorContractOf,
} from "./registeredFunctions";

describe("registered Convex test adapters", () => {
  it("invokes a callable private handler with its owner bound", async () => {
    const registeredFunction = {
      prefix: "bound",
      async _handler(ctx: { suffix: string }, args: { value: number }) {
        return `${this.prefix}:${ctx.suffix}:${args.value}`;
      },
    };

    const result = invokeRegistered(
      registeredFunction,
      { suffix: "context" },
      { value: 42 },
    );
    expectTypeOf(result).toEqualTypeOf<Promise<string>>();
    await expect(result).resolves.toBe("bound:context:42");

    const proveResultCannotBeForged = () =>
      invokeRegistered<{ value: number }, { forged: true }>(
        // @ts-expect-error The handler's return type, not the caller, is authoritative.
        registeredFunction,
        { suffix: "context" },
        { value: 42 },
      );
    void proveResultCannotBeForged;
  });

  it("binds and validates both validator exporters", () => {
    const registeredFunction = {
      argsJson: '{"type":"object"}',
      returnsJson: '{"type":"string"}',
      exportArgs() {
        return this.argsJson;
      },
      exportReturns() {
        return this.returnsJson;
      },
    };

    const contract = validatorContractOf(registeredFunction);
    expect(contract.exportArgs()).toBe(registeredFunction.argsJson);
    expect(contract.exportReturns()).toBe(registeredFunction.returnsJson);
  });

  it("fails closed when private members are absent or malformed", async () => {
    const malformedHandler = {
      async _handler(ctx: never, args: Record<string, never>) {
        void ctx;
        void args;
      },
    };
    Object.defineProperty(malformedHandler, "_handler", { value: 42 });

    await expect(invokeRegistered(malformedHandler, {}, {})).rejects.toThrow(
      "_handler is not callable",
    );
    expect(() =>
      validatorContractOf({ exportArgs: () => "{}" }),
    ).toThrow("validator exporters are not callable");
    expect(() =>
      validatorContractOf({
        exportArgs: () => ({}),
        exportReturns: () => "{}",
      }).exportArgs(),
    ).toThrow("did not return JSON text");
  });
});
