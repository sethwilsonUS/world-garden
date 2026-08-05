import { useRouter } from "expo-router";

import { getMobileRuntimeConfig } from "../src/config/runtime-config";
import { navigateBackOrReplace } from "../src/navigation/back-navigation";
import { AccountScreen } from "../src/screens/AccountScreen";

export default function AccountRoute() {
  const router = useRouter();
  const { appVariant } = getMobileRuntimeConfig();

  return (
    <AccountScreen
      isProductionEnvironment={appVariant === "production"}
      onBack={() => navigateBackOrReplace(router, "/")}
    />
  );
}
