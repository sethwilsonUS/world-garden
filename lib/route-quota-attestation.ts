import {
  createServerAttestation,
  requireServerAttestationSecret,
  type ServerAttestation,
  type ServerAttestationPayloadValue,
} from "./server-attestation";

export const ROUTE_QUOTA_ATTESTATION_SCOPE = "route-quota:consume";

export type RouteQuotaParameters = {
  key: string;
  limit: number;
  windowMs: number;
};

export type AttestedRouteQuotaArgs = RouteQuotaParameters & {
  attestation: ServerAttestation;
};

export const getRouteQuotaAttestationPayload = ({
  key,
  limit,
  windowMs,
}: RouteQuotaParameters): readonly ServerAttestationPayloadValue[] => [
  key,
  limit,
  windowMs,
];

export const assertValidRouteQuotaParameters = ({
  key,
  limit,
  windowMs,
}: RouteQuotaParameters): void => {
  if (
    !key ||
    key.length > 512 ||
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    !Number.isSafeInteger(windowMs) ||
    windowMs <= 0
  ) {
    throw new Error("Invalid route quota parameters.");
  }
};

export const createAttestedRouteQuotaArgs = async (
  parameters: RouteQuotaParameters,
): Promise<AttestedRouteQuotaArgs> => {
  assertValidRouteQuotaParameters(parameters);
  const secret = requireServerAttestationSecret();
  const attestation = await createServerAttestation({
    scope: ROUTE_QUOTA_ATTESTATION_SCOPE,
    payload: getRouteQuotaAttestationPayload(parameters),
    secret,
  });

  return { ...parameters, attestation };
};
