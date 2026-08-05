import type { ConfigPlugin } from "expo/config-plugins";

export declare const SPM_UUID_SAFETY_MARKER: string;
export declare const applyReactNativeSpmUuidSafety: (podfile: string) => string;

declare const withReactNativeSpmUuidSafety: ConfigPlugin;
export default withReactNativeSpmUuidSafety;
