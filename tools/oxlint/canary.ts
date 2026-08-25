// This file must fail anti-slop linting in five specific ways. The verifier
// excludes it from project scans and checks every expected rule independently.

type HiddenCanaryBoundary = unknown;

const chainedCanary = {} as unknown as { readonly value: string };
const widenedCanary: unknown = { value: "canary" };
const narrowedCanary = widenedCanary as { readonly value: string };

Reflect.apply(() => undefined, null, []);
Reflect.get({}, "value");

void (null as HiddenCanaryBoundary);
void chainedCanary;
void narrowedCanary;
