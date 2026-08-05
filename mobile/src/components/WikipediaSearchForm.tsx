import { useState, type ReactElement } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { normalizeWikipediaSearchTerm } from "@curio-garden/domain";

import { GardenText } from "../theme/GardenText";
import { useGardenTheme } from "../theme/useGardenTheme";
import { AccessibleStatus } from "./AccessibleStatus";
import { GardenButton } from "./GardenButton";

const EMPTY_SEARCH_MESSAGE = "Enter a topic to search Wikipedia.";
const SEARCH_INPUT_ID = "wikipedia-search-topic";

export interface WikipediaSearchFormProps {
  defaultValue?: string;
  onSubmit: (term: string) => void;
}

export function WikipediaSearchForm({
  defaultValue = "",
  onSubmit,
}: WikipediaSearchFormProps): ReactElement {
  const { colors, fonts, radii, spacing } = useGardenTheme();
  const [focused, setFocused] = useState(false);
  const [term, setTerm] = useState(defaultValue);
  const [error, setError] = useState("");

  const submit = () => {
    const normalizedTerm = normalizeWikipediaSearchTerm(term);
    if (!normalizedTerm) {
      setError(EMPTY_SEARCH_MESSAGE);
      return;
    }

    setError("");
    onSubmit(normalizedTerm);
  };

  return (
    <View accessible={false} style={{ gap: spacing.md }}>
      <GardenText accessible={false} nativeID={`${SEARCH_INPUT_ID}-label`}>
        Search topic
      </GardenText>
      <TextInput
        accessibilityHint={
          error ? "A search topic is required." : "Enter a Wikipedia topic."
        }
        accessibilityLabel="Search topic"
        accessibilityLabelledBy={`${SEARCH_INPUT_ID}-label`}
        allowFontScaling
        autoCapitalize="sentences"
        autoComplete="off"
        autoCorrect={false}
        clearButtonMode="while-editing"
        onBlur={() => setFocused(false)}
        onChangeText={(value) => {
          setTerm(value);
          if (error) setError("");
        }}
        onFocus={() => setFocused(true)}
        onSubmitEditing={submit}
        placeholder="Try orchids"
        placeholderTextColor={colors.muted}
        returnKeyType="search"
        selectionColor={colors.accent}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            borderColor: error
              ? colors.critical
              : focused
                ? colors.accent
                : colors.controlBorder,
            borderRadius: radii.xl,
            color: colors.foreground,
            fontFamily: fonts.bodyRegular,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
          },
          focused
            ? [styles.focused, { outlineColor: colors.accent }]
            : undefined,
        ]}
        value={term}
      />
      <AccessibleStatus
        accessibilityRole={error ? "alert" : undefined}
        color="critical"
        message={error}
        testID="wikipedia-search-error"
      />
      <GardenButton label="Search" onPress={submit} />
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 2,
    fontSize: 17,
    lineHeight: 26,
    minHeight: 48,
    minWidth: 48,
  },
  focused: {
    outlineOffset: 2,
    outlineStyle: "solid",
    outlineWidth: 3,
  },
});
