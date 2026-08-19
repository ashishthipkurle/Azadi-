// Shared UI primitives used across the reader/reporter/admin routes.
// Kept small and dependency-free so the design tokens in theme.ts stay
// the single source of truth.
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { C } from "@/src/theme";

export function Icon({
  name,
  color = C.ink,
  size = 20,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color?: string;
  size?: number;
}) {
  return <Ionicons name={name} color={color} size={size} />;
}

type ButtonTone = "dark" | "red" | "paper" | "outline" | "ghost";

export function Button({
  children,
  onPress,
  tone = "dark",
  testID,
  disabled,
  loading,
  icon,
}: {
  children: string;
  onPress: () => void | Promise<void>;
  tone?: ButtonTone;
  testID?: string;
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable
      testID={testID}
      disabled={disabled || loading}
      onPress={() => Promise.resolve(onPress()).catch(() => {})}
      style={({ pressed }) => [
        styles.button,
        tone === "red" && styles.redButton,
        tone === "paper" && styles.paperButton,
        tone === "outline" && styles.outlineButton,
        tone === "ghost" && styles.ghostButton,
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
      ]}
    >
      {icon ? (
        <Icon
          name={icon}
          color={tone === "paper" || tone === "outline" || tone === "ghost" ? C.ink : C.surface}
          size={17}
        />
      ) : null}
      <Text
        style={[
          styles.buttonText,
          (tone === "paper" || tone === "outline" || tone === "ghost") && styles.paperButtonText,
        ]}
      >
        {loading ? "Working…" : children}
      </Text>
    </Pressable>
  );
}

export function Toast({
  message,
  tone = "info",
  onDismiss,
  testID = "toast",
}: {
  message: string;
  tone?: "info" | "success" | "error";
  onDismiss?: () => void;
  testID?: string;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() =>
        onDismiss?.(),
      );
    }, 3200);
    return () => clearTimeout(t);
  }, [message, opacity, onDismiss]);

  const palette =
    tone === "success"
      ? { bg: "#E4EFE8", text: C.green, icon: "checkmark-circle" as const }
      : tone === "error"
        ? { bg: "#F5E5E2", text: C.red, icon: "alert-circle" as const }
        : { bg: "#E7EEF2", text: C.blue, icon: "information-circle" as const };

  return (
    <Animated.View
      testID={testID}
      style={[styles.toast, { backgroundColor: palette.bg, opacity }]}
      pointerEvents="none"
    >
      <Icon name={palette.icon} color={palette.text} size={18} />
      <Text style={[styles.toastText, { color: palette.text }]}>{message}</Text>
    </Animated.View>
  );
}

export function Overline({ children, tone }: { children: string; tone?: string }) {
  return <Text style={[styles.overline, tone ? { color: tone } : null]}>{children}</Text>;
}

export function Rule() {
  return <View style={styles.rule} />;
}

export function EmptyState({ title, body, icon }: { title: string; body: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.empty}>
      {icon ? <Icon name={icon} color={C.muted} size={28} /> : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: C.ink,
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
    borderRadius: 6,
    marginTop: 10,
  },
  redButton: { backgroundColor: C.red },
  paperButton: { backgroundColor: C.paper },
  outlineButton: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.line },
  ghostButton: { backgroundColor: "transparent" },
  buttonText: { color: C.surface, fontWeight: "800", fontSize: 14 },
  paperButtonText: { color: C.ink },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.5 },
  toast: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 100,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 8,
    zIndex: 999,
  },
  toastText: { flex: 1, fontSize: 13, fontWeight: "700" },
  overline: { color: C.muted, fontSize: 11, letterSpacing: 1.5, fontWeight: "800" },
  rule: { height: 1, backgroundColor: C.line, marginVertical: 24 },
  empty: {
    borderWidth: 1,
    borderColor: C.line,
    padding: 22,
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    backgroundColor: C.surface,
  },
  emptyTitle: { color: C.ink, fontSize: 18, fontWeight: "800", textAlign: "center" },
  emptyBody: { color: C.muted, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
