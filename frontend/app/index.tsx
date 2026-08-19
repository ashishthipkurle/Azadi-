// Entry screen:
// 1. If the auth context is still hydrating -> spinner.
// 2. If the user is logged in -> redirect to their role home.
// 3. Otherwise -> unauthenticated landing with sign-in / register.
import { Redirect } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ApiError } from "@/src/api";
import { Role, useAuth } from "@/src/auth";
import { C } from "@/src/theme";
import { Button, Icon, Overline, Toast } from "@/src/ui";

type Mode = "landing" | "login" | "register";

export default function Index() {
  const { ready, user, login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("landing");
  const [role, setRole] = useState<Role>("client");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);

  if (!ready) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={C.red} />
        </View>
      </SafeAreaView>
    );
  }
  if (user) {
    const dest = user.role === "reporter" ? "/(reporter)/studio" : user.role === "admin" ? "/(admin)/dashboard" : "/(reader)/feed";
    return <Redirect href={dest} />;
  }

  const submit = async () => {
    if (busy) return;
    if (!email.trim() || !password) {
      setToast({ message: "Enter your email and password", tone: "error" });
      return;
    }
    if (mode === "register" && name.trim().length < 2) {
      setToast({ message: "Tell us the name to show on your byline", tone: "error" });
      return;
    }
    setBusy(true);
    try {
      if (mode === "register") await register(name.trim(), email.trim(), password, role);
      else await login(email.trim(), password);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Could not reach the server. Try again in a moment.";
      setToast({ message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Text style={styles.wordmark}>freepress</Text>
            <View style={styles.signalDot} />
          </View>

          {mode === "landing" ? (
            <>
              <Overline>INDEPENDENT JOURNALISM · UNCENSORED · ACCOUNTABLE</Overline>
              <Text style={styles.hero}>Your story.{"\n"}Your signal.</Text>
              <Text style={styles.heroBody}>
                A place for field reporters and the people who choose to listen — without editorial gatekeeping.
              </Text>

              <View style={styles.spacerLg} />
              <Button testID="landing-signin-button" onPress={() => setMode("login")}>Sign in</Button>
              <Button testID="landing-signup-button" onPress={() => setMode("register")} tone="outline">
                Create an account
              </Button>

              <View style={styles.footer}>
                <Text style={styles.footerText}>
                  By continuing you agree to our transparent moderation policy: no silent takedowns, evidence required, appeal always available.
                </Text>
              </View>
            </>
          ) : (
            <>
              <Pressable testID="auth-back" onPress={() => setMode("landing")} style={styles.back}>
                <Icon name="chevron-back" color={C.ink} />
                <Text style={styles.backText}>Back</Text>
              </Pressable>

              <Text style={styles.title}>{mode === "login" ? "Welcome back." : "Join the newsroom."}</Text>
              <Text style={styles.subtitle}>
                {mode === "login"
                  ? "Sign in to keep reading and supporting reporters you trust."
                  : "Independent reporters, curious readers, and moderators all live here."}
              </Text>

              {mode === "register" ? (
                <>
                  <Overline>NAME</Overline>
                  <TextInput
                    testID="auth-name-input"
                    style={styles.input}
                    placeholder="How your byline should read"
                    placeholderTextColor="#8A8F91"
                    value={name}
                    onChangeText={setName}
                    autoCapitalize="words"
                  />

                  <Overline>I AM A</Overline>
                  <View style={styles.roleRow}>
                    {(["client", "reporter"] as const).map((r) => (
                      <Pressable
                        key={r}
                        testID={`auth-role-${r}`}
                        onPress={() => setRole(r)}
                        style={[styles.roleChip, role === r && styles.roleChipActive]}
                      >
                        <Icon
                          name={r === "reporter" ? "radio-outline" : "newspaper-outline"}
                          color={role === r ? C.surface : C.ink}
                          size={18}
                        />
                        <Text style={[styles.roleChipText, role === r && styles.roleChipTextActive]}>
                          {r === "reporter" ? "Reporter" : "Reader"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.helper}>
                    Admin accounts are provisioned by the platform team. Ask an existing admin to promote you.
                  </Text>
                </>
              ) : null}

              <Overline>EMAIL</Overline>
              <TextInput
                testID="auth-email-input"
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="#8A8F91"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />

              <Overline>PASSWORD</Overline>
              <TextInput
                testID="auth-password-input"
                style={styles.input}
                placeholder="At least 6 characters"
                placeholderTextColor="#8A8F91"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />

              <Button
                testID="auth-submit-button"
                onPress={submit}
                loading={busy}
                tone={mode === "register" ? "red" : "dark"}
              >
                {mode === "login" ? "Sign in" : "Create account"}
              </Button>

              <Pressable
                testID="auth-toggle-mode"
                onPress={() => setMode(mode === "login" ? "register" : "login")}
                style={styles.toggle}
              >
                <Text style={styles.toggleText}>
                  {mode === "login" ? "New here? Create an account." : "Already have an account? Sign in."}
                </Text>
              </Pressable>

              {mode === "login" ? (
                <View style={styles.demoBox}>
                  <Overline>TRY THE PLATFORM</Overline>
                  <Text style={styles.demoLine}>Admin · admin@freepress.in / admin123</Text>
                  <Text style={styles.demoLine}>Reporter · rhea@freepress.in / reporter123</Text>
                  <Text style={styles.demoLine}>Reader · reader@freepress.in / reader123</Text>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {toast ? <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper },
  scroll: { padding: 24, paddingTop: 32, paddingBottom: 64 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  brand: { flexDirection: "row", alignItems: "flex-start", marginBottom: 40 },
  wordmark: { color: C.ink, fontSize: 28, fontWeight: "800", letterSpacing: -1.5 },
  signalDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.red, marginLeft: 6, marginTop: 8 },
  hero: { color: C.ink, fontSize: 44, lineHeight: 46, fontWeight: "800", letterSpacing: -2, marginTop: 12 },
  heroBody: { color: C.muted, fontSize: 16, lineHeight: 25, marginTop: 18, maxWidth: 340 },
  spacerLg: { height: 36 },
  footer: { marginTop: 40, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 18 },
  footerText: { color: C.muted, fontSize: 12, lineHeight: 18 },
  back: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 18 },
  backText: { color: C.ink, fontSize: 14, fontWeight: "700" },
  title: { color: C.ink, fontSize: 32, fontWeight: "800", letterSpacing: -1, marginTop: 8 },
  subtitle: { color: C.muted, fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 24 },
  input: {
    color: C.ink,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    marginTop: 8,
    marginBottom: 18,
    borderRadius: 6,
  },
  helper: { color: C.muted, fontSize: 12, marginTop: 6, marginBottom: 6 },
  roleRow: { flexDirection: "row", gap: 10, marginTop: 8, marginBottom: 12 },
  roleChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: C.line,
    paddingVertical: 14,
    borderRadius: 6,
    backgroundColor: C.surface,
  },
  roleChipActive: { backgroundColor: C.ink, borderColor: C.ink },
  roleChipText: { color: C.ink, fontWeight: "800", fontSize: 14 },
  roleChipTextActive: { color: C.surface },
  toggle: { marginTop: 16, alignItems: "center" },
  toggleText: { color: C.muted, fontSize: 13, textDecorationLine: "underline" },
  demoBox: {
    marginTop: 28,
    borderWidth: 1,
    borderColor: C.line,
    padding: 14,
    backgroundColor: C.surface,
    gap: 4,
  },
  demoLine: { color: C.ink, fontSize: 12, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
});
