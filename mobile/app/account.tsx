import { useIsFocused, useRouter } from "expo-router";

import { getMobileRuntimeConfig } from "../src/config/runtime-config";
import { navigateBackOrReplace } from "../src/navigation/back-navigation";
import { AccountScreen } from "../src/screens/AccountScreen";

export default function AccountRoute() {
  const router = useRouter();
  const isRouteActive = useIsFocused();
  const { appVariant } = getMobileRuntimeConfig();

  return (
    <AccountScreen
      isRouteActive={isRouteActive}
      isProductionEnvironment={appVariant === "production"}
      onBack={() => navigateBackOrReplace(router, "/")}
    />
  );
}
