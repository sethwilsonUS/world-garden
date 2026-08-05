import { redirectIncomingSystemPath } from "../src/navigation/routes";

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  return redirectIncomingSystemPath(path);
}
