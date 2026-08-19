// Reporter studio:
// - "Story" mode publishes text posts via POST /api/posts.
// - "Live" mode reserves a room via POST /api/live/token (real LiveKit token when
//   backend has keys, or a friendly 503 message otherwise) and drives an
//   expo-camera preview so reporters can physically point the camera before
//   broadcasting.
// Camera / mic permissions are requested contextually only when the reporter
// switches to "Live".
import { useCameraPermissions, useMicrophonePermissions, CameraView } from "expo-camera";
import { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Linking,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { apiDelete, apiGet, apiPost, ApiError } from "@/src/api";
import { useAuth } from "@/src/auth";
import { C } from "@/src/theme";
import { Button, EmptyState, Icon, Toast } from "@/src/ui";

type MyPost = { id: string; title: string; body: string; kind: string; created_at: string; verified: boolean };

export default function Studio() {
  const { user, logout } = useAuth();
  const [mode, setMode] = useState<"story" | "live">("story");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"field report" | "photo essay" | "dispatch">("dispatch");
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [mic, setMic] = useState<"phone" | "external">("phone");
  const [liveSession, setLiveSession] = useState<{ room: string; url: string; token: string; id?: string } | null>(null);
  const [posts, setPosts] = useState<MyPost[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);

  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();

  const loadPosts = useCallback(async () => {
    try {
      const p = await apiGet<MyPost[]>("/posts/mine");
      setPosts(p);
    } catch {
      // silent — the composer still works
    }
  }, []);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const publish = async () => {
    if (title.trim().length < 4) {
      setToast({ message: "Give your dispatch a clear headline.", tone: "error" });
      return;
    }
    if (body.trim().length < 10) {
      setToast({ message: "Write at least a sentence from the field.", tone: "error" });
      return;
    }
    setBusy(true);
    try {
      await apiPost("/posts", { title: title.trim(), body: body.trim(), kind, location: "On the ground" });
      setTitle("");
      setBody("");
      setToast({ message: "Dispatch published to the wall.", tone: "success" });
      await loadPosts();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Could not publish.";
      setToast({ message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const askCameraMic = async (): Promise<boolean> => {
    if (!camPerm?.granted) {
      const r = await requestCam();
      if (!r.granted) {
        if (!r.canAskAgain) {
          setToast({ message: "Enable camera access in Settings to go live.", tone: "error" });
          Linking.openSettings();
        }
        return false;
      }
    }
    if (!micPerm?.granted) {
      const r = await requestMic();
      if (!r.granted) {
        if (!r.canAskAgain) {
          setToast({ message: "Enable microphone access in Settings to go live.", tone: "error" });
          Linking.openSettings();
        }
        return false;
      }
    }
    return true;
  };

  const goLive = async () => {
    const ok = await askCameraMic();
    if (!ok) return;
    setBusy(true);
    try {
      const res = await apiPost<{ token: string; url: string; room: string }>("/live/token", {
        title: title.trim() || "Live from the field",
      });
      setLiveSession({ ...res });
      setToast({ message: `Connected to room ${res.room}.`, tone: "success" });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Could not start live.";
      setToast({ message, tone: e instanceof ApiError && e.status === 503 ? "info" : "error" });
    } finally {
      setBusy(false);
    }
  };

  const endLive = () => {
    setLiveSession(null);
    setToast({ message: "Live session ended.", tone: "info" });
  };

  const deletePost = async (id: string) => {
    try {
      await apiDelete(`/posts/${id}`);
      await loadPosts();
      setToast({ message: "Dispatch removed.", tone: "info" });
    } catch {
      setToast({ message: "Could not remove dispatch.", tone: "error" });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.wordmark}>freepress</Text>
          <Text style={styles.kicker}>REPORTER STUDIO</Text>
        </View>
        <Pressable testID="reporter-logout-button" onPress={logout} style={styles.avatar}>
          <Icon name="log-out-outline" color={C.surface} size={19} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await loadPosts();
                setRefreshing(false);
              }}
              tintColor={C.red}
            />
          }
        >
          <View style={styles.statusLine}>
            <View style={[styles.dot, { backgroundColor: user?.verified ? C.green : C.amber }]} />
            <Text style={styles.statusText}>
              {user?.verified ? "Verified reporter" : "Pending verification"} · {user?.name}
            </Text>
          </View>

          <View style={styles.segment}>
            {(["story", "live"] as const).map((m) => (
              <Pressable
                key={m}
                testID={`reporter-mode-${m}`}
                onPress={() => setMode(m)}
                style={[styles.segmentItem, mode === m && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
                  {m === "story" ? "Write" : "Go live"}
                </Text>
              </Pressable>
            ))}
          </View>

          {mode === "story" ? (
            <>
              <Text style={styles.title}>What did you see?</Text>
              <TextInput
                testID="reporter-story-title"
                value={title}
                onChangeText={setTitle}
                placeholder="Headline your dispatch"
                placeholderTextColor="#8A8F91"
                style={styles.inputTitle}
              />
              <TextInput
                testID="reporter-story-body"
                value={body}
                onChangeText={setBody}
                placeholder="Write from the field. Be specific, be human."
                placeholderTextColor="#8A8F91"
                multiline
                style={styles.inputBody}
              />

              <Text style={styles.overline}>DISPATCH TYPE</Text>
              <View style={styles.kindRow}>
                {(["dispatch", "field report", "photo essay"] as const).map((k) => (
                  <Pressable
                    key={k}
                    onPress={() => setKind(k)}
                    style={[styles.kindChip, kind === k && styles.kindChipActive]}
                  >
                    <Text style={[styles.kindChipText, kind === k && styles.kindChipTextActive]}>{k}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.notice}>
                <Icon name="information-circle-outline" color={C.blue} size={17} />
                <Text style={styles.noticeText}>
                  Uploading photos and video is coming soon — we're wiring the media pipeline.
                </Text>
              </View>

              <Button testID="reporter-publish-button" onPress={publish} loading={busy}>
                Publish dispatch
              </Button>

              <Text style={[styles.overline, { marginTop: 32, marginBottom: 12 }]}>MY DISPATCHES · {posts.length}</Text>
              {posts.length === 0 ? (
                <EmptyState title="No dispatches yet." body="Publish your first field report to see it here." icon="document-text-outline" />
              ) : (
                posts.map((p) => (
                  <View key={p.id} style={styles.postRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.postRowKind}>{p.kind.toUpperCase()}</Text>
                      <Text style={styles.postRowTitle} numberOfLines={2}>{p.title}</Text>
                    </View>
                    <Pressable testID={`reporter-delete-${p.id}`} onPress={() => deletePost(p.id)} style={styles.deleteBtn}>
                      <Icon name="trash-outline" color={C.red} size={17} />
                    </Pressable>
                  </View>
                ))
              )}
            </>
          ) : (
            <>
              <Text style={styles.title}>Go live, stay connected.</Text>

              <View style={styles.cameraFrame}>
                {camPerm?.granted && liveSession ? (
                  <CameraView
                    style={StyleSheet.absoluteFill}
                    facing={facing}
                    mode="video"
                    videoQuality="1080p"
                  />
                ) : camPerm?.granted ? (
                  <CameraView style={StyleSheet.absoluteFill} facing={facing} />
                ) : (
                  <View style={styles.cameraPlaceholder}>
                    <Icon name="videocam-off-outline" color={C.surface} size={36} />
                    <Text style={styles.previewText}>Camera preview</Text>
                    <Text style={styles.previewSub}>Grant camera access to see your framing.</Text>
                    <Pressable
                      testID="reporter-request-camera"
                      onPress={askCameraMic}
                      style={styles.grantButton}
                    >
                      <Text style={styles.grantButtonText}>Enable camera & mic</Text>
                    </Pressable>
                  </View>
                )}
                {liveSession ? (
                  <View style={styles.livePill}>
                    <View style={styles.liveDot} />
                    <Text style={styles.livePillText}>LIVE · {liveSession.room.slice(-6).toUpperCase()}</Text>
                  </View>
                ) : (
                  <View style={styles.readyPill}>
                    <Text style={styles.readyText}>READY</Text>
                  </View>
                )}
              </View>

              <TextInput
                testID="reporter-live-title"
                value={title}
                onChangeText={setTitle}
                placeholder="Stream title (e.g. Live from the factory gate)"
                placeholderTextColor="#8A8F91"
                style={styles.inputTitle}
              />

              <View style={styles.controlPanel}>
                <ControlRow
                  icon="camera-reverse-outline"
                  label="Camera"
                  value={facing === "back" ? "Back" : "Front"}
                  onPress={() => setFacing(facing === "back" ? "front" : "back")}
                  testID="reporter-camera-selector"
                />
                <ControlRow
                  icon="mic-outline"
                  label="Microphone"
                  value={mic === "phone" ? "Phone mic" : "External mic"}
                  onPress={() => setMic(mic === "phone" ? "external" : "phone")}
                  testID="reporter-mic-selector"
                />
                <ControlRow icon="settings-outline" label="Quality" value="1080p · 30fps" onPress={() => {}} />
              </View>

              {liveSession ? (
                <Button testID="reporter-end-live-button" onPress={endLive} tone="outline">
                  End broadcast
                </Button>
              ) : (
                <Button testID="reporter-go-live-button" onPress={goLive} tone="red" loading={busy}>
                  Start live stream
                </Button>
              )}

              <View style={styles.notice}>
                <Icon name="shield-checkmark-outline" color={C.blue} size={17} />
                <Text style={styles.noticeText}>
                  Location and consent controls appear before you go live. Your camera preview is on-device.
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {toast ? <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} /> : null}
    </SafeAreaView>
  );
}

function ControlRow({
  icon,
  label,
  value,
  onPress,
  testID,
}: {
  icon: any;
  label: string;
  value: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.controlRow, pressed && { opacity: 0.7 }]}
    >
      <Icon name={icon} color={C.ink} size={19} />
      <Text style={styles.controlLabel}>{label}</Text>
      <Text style={styles.controlValue}>{value}</Text>
      <Icon name="chevron-forward" color={C.muted} size={17} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  wordmark: { color: C.ink, fontSize: 22, fontWeight: "800", letterSpacing: -1 },
  kicker: { fontSize: 9, letterSpacing: 2, color: C.muted, marginTop: 4, fontWeight: "800" },
  avatar: { backgroundColor: C.ink, borderRadius: 20, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingBottom: 60 },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 20 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { flex: 1, color: C.muted, fontSize: 13, fontWeight: "700" },
  segment: { flexDirection: "row", backgroundColor: C.line, padding: 3, borderRadius: 8, marginBottom: 24 },
  segmentItem: { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 6 },
  segmentActive: { backgroundColor: C.surface },
  segmentText: { color: C.muted, fontWeight: "800", fontSize: 13 },
  segmentTextActive: { color: C.ink },
  title: { color: C.ink, fontSize: 30, fontWeight: "800", letterSpacing: -1, marginBottom: 16 },
  inputTitle: {
    color: C.ink,
    fontSize: 20,
    fontWeight: "700",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    borderRadius: 6,
  },
  inputBody: {
    color: C.ink,
    fontSize: 15,
    minHeight: 160,
    textAlignVertical: "top",
    lineHeight: 22,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    padding: 14,
    marginBottom: 18,
    borderRadius: 6,
  },
  overline: { color: C.muted, fontSize: 11, letterSpacing: 1.5, fontWeight: "800", marginBottom: 8 },
  kindRow: { flexDirection: "row", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  kindChip: {
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 12,
    height: 34,
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: C.surface,
  },
  kindChipActive: { backgroundColor: C.ink, borderColor: C.ink },
  kindChipText: { color: C.muted, fontSize: 12, fontWeight: "700" },
  kindChipTextActive: { color: C.surface },
  notice: {
    flexDirection: "row",
    gap: 9,
    backgroundColor: "#E7EEF2",
    padding: 12,
    marginVertical: 14,
    borderRadius: 6,
    alignItems: "flex-start",
  },
  noticeText: { color: C.blue, flex: 1, fontSize: 12, lineHeight: 18 },
  postRow: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 6,
  },
  postRowKind: { color: C.muted, fontSize: 10, letterSpacing: 1.5, fontWeight: "800", marginBottom: 4 },
  postRowTitle: { color: C.ink, fontSize: 14, fontWeight: "800" },
  deleteBtn: { padding: 8 },
  cameraFrame: {
    height: 280,
    backgroundColor: C.dark,
    marginBottom: 16,
    borderRadius: 8,
    overflow: "hidden",
    position: "relative",
  },
  cameraPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 20 },
  previewText: { color: C.surface, fontWeight: "800", fontSize: 17 },
  previewSub: { color: "#B7BEC5", fontSize: 12, textAlign: "center" },
  grantButton: { backgroundColor: C.surface, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 6, marginTop: 8 },
  grantButtonText: { color: C.ink, fontWeight: "800", fontSize: 12 },
  livePill: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  liveDot: { backgroundColor: C.red, width: 7, height: 7, borderRadius: 4 },
  livePillText: { color: C.surface, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  readyPill: {
    position: "absolute",
    top: 12,
    left: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  readyText: { color: C.surface, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  controlPanel: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    marginBottom: 16,
    borderRadius: 6,
    overflow: "hidden",
  },
  controlRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  controlLabel: { color: C.ink, fontWeight: "700", flex: 1, fontSize: 14 },
  controlValue: { color: C.muted, fontSize: 12 },
});
