// Reporter studio:
// - "Write" mode publishes text posts via POST /api/posts, with optional Mux
//   media attachments (image or video, uploaded via /api/media/upload-url).
// - "Go live" mode requests a LiveKit token from POST /api/live/token, then
//   connects to the room and publishes camera + mic tracks.
//
// Both flows fall back to a friendly "coming soon" message when the backend
// returns HTTP 503 (provider keys not yet configured).
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { apiDelete, apiGet, apiPost, ApiError } from "@/src/api";
import { useAuth } from "@/src/auth";
import { LiveStage } from "@/src/live-stage";
import { publishLive, type LiveConnection } from "@/src/livekit";
import { MediaPlayer, type MediaAttachment } from "@/src/media-player";
import { uploadToMux } from "@/src/mux";
import { C } from "@/src/theme";
import { Button, EmptyState, Icon, Toast } from "@/src/ui";

type MyPost = {
  id: string;
  title: string;
  body: string;
  kind: string;
  created_at: string;
  verified: boolean;
  media?: MediaAttachment[];
};

type Earnings = {
  lifetime: number;
  verified_count: number;
  pending_amount: number;
  pending_count: number;
  monthly_pledges: number;
  top_supporters: { supporter_id: string; name: string; total: number; count: number }[];
};

type Attachment = {
  kind: "image" | "video";
  local_uri: string;
  playback_id?: string;
  status: "uploading" | "processing" | "ready" | "error";
};

export default function Studio() {
  const { user, logout } = useAuth();
  const [mode, setMode] = useState<"story" | "live" | "earnings">("story");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"field report" | "photo essay" | "dispatch">("dispatch");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [connection, setConnection] = useState<LiveConnection | null>(null);
  const [sessionMeta, setSessionMeta] = useState<{ room: string } | null>(null);
  const [localVideoTrack, setLocalVideoTrack] = useState<any>(null);
  const [posts, setPosts] = useState<MyPost[]>([]);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);
  const disconnectingRef = useRef(false);

  const loadPosts = useCallback(async () => {
    try {
      const p = await apiGet<MyPost[]>("/posts/mine");
      setPosts(p);
    } catch {
      /* silent */
    }
  }, []);

  const loadEarnings = useCallback(async () => {
    try {
      const e = await apiGet<Earnings>("/reporter/earnings");
      setEarnings(e);
    } catch {
      /* silent — earnings tab shows its own empty state */
    }
  }, []);

  useEffect(() => {
    loadPosts();
    loadEarnings();
  }, [loadPosts, loadEarnings]);

  // Clean up any live connection when the studio unmounts.
  useEffect(() => {
    return () => {
      if (connection) connection.disconnect().catch(() => {});
    };
  }, [connection]);

  const attachMedia = async (variant: "image" | "video") => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) {
        setToast({ message: "Enable photo access in Settings to attach media.", tone: "error" });
        Linking.openSettings();
      } else {
        setToast({ message: "Photo access is needed to attach media.", tone: "info" });
      }
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes:
        variant === "image"
          ? ImagePicker.MediaTypeOptions.Images
          : ImagePicker.MediaTypeOptions.Videos,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const entry: Attachment = { kind: variant, local_uri: asset.uri, status: "uploading" };
    setAttachments((prev) => [...prev, entry]);
    try {
      const media = await uploadToMux(
        {
          uri: asset.uri,
          fileName: asset.fileName || undefined,
          mimeType: asset.mimeType || undefined,
        },
        (phase) => {
          setAttachments((prev) =>
            prev.map((a) => (a.local_uri === asset.uri ? { ...a, status: phase } : a)),
          );
        },
      );
      setAttachments((prev) =>
        prev.map((a) =>
          a.local_uri === asset.uri
            ? { ...a, status: media.playback_id ? "ready" : "processing", playback_id: media.playback_id }
            : a,
        ),
      );
      if (!media.playback_id) {
        setToast({ message: "Mux is still processing — you can publish and it'll appear soon.", tone: "info" });
      }
    } catch (e) {
      setAttachments((prev) => prev.map((a) => (a.local_uri === asset.uri ? { ...a, status: "error" } : a)));
      const message = e instanceof ApiError ? e.message : "Upload failed.";
      setToast({ message, tone: e instanceof ApiError && e.status === 503 ? "info" : "error" });
    }
  };

  const removeAttachment = (uri: string) =>
    setAttachments((prev) => prev.filter((a) => a.local_uri !== uri));

  const publish = async () => {
    if (title.trim().length < 4) {
      setToast({ message: "Give your dispatch a clear headline.", tone: "error" });
      return;
    }
    if (body.trim().length < 10) {
      setToast({ message: "Write at least a sentence from the field.", tone: "error" });
      return;
    }
    const uploading = attachments.filter((a) => a.status === "uploading");
    if (uploading.length) {
      setToast({ message: "Wait for uploads to finish before publishing.", tone: "info" });
      return;
    }
    setBusy(true);
    try {
      const media = attachments
        .filter((a) => a.status === "ready" || a.status === "processing")
        .map((a) => ({ kind: a.kind, playback_id: a.playback_id }));
      await apiPost("/posts", {
        title: title.trim(),
        body: body.trim(),
        kind,
        location: "On the ground",
        media,
      });
      setTitle("");
      setBody("");
      setAttachments([]);
      setToast({ message: "Dispatch published to the wall.", tone: "success" });
      await loadPosts();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Could not publish.";
      setToast({ message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const goLive = async () => {
    setBusy(true);
    try {
      const res = await apiPost<{ token: string; url: string; room: string }>("/live/token", {
        title: title.trim() || "Live from the field",
      });
      const conn = await publishLive({ url: res.url, token: res.token });
      setConnection(conn);
      setSessionMeta({ room: res.room });
      // Grab the local video track once it's published so we can preview it.
      const attach = () => {
        const pub = conn.room.localParticipant.getTrackPublication?.((globalThis as any).LKKind?.Video || "video");
        if (pub?.track) setLocalVideoTrack(pub.track);
      };
      attach();
      setTimeout(attach, 500);
      setTimeout(attach, 1500);
      setToast({ message: `Live in room ${res.room.slice(-6)}. Readers can watch now.`, tone: "success" });
    } catch (e) {
      const message =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? `Live could not start: ${e.message}`
            : "Live could not start.";
      const tone = e instanceof ApiError && e.status === 503 ? "info" : "error";
      setToast({ message, tone });
    } finally {
      setBusy(false);
    }
  };

  const endLive = async () => {
    if (disconnectingRef.current) return;
    disconnectingRef.current = true;
    try {
      if (connection) await connection.disconnect();
    } catch {
      /* ignore */
    }
    setConnection(null);
    setLocalVideoTrack(null);
    setSessionMeta(null);
    setToast({ message: "Broadcast ended.", tone: "info" });
    disconnectingRef.current = false;
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
            {(["story", "live", "earnings"] as const).map((m) => (
              <Pressable
                key={m}
                testID={`reporter-mode-${m}`}
                onPress={() => {
                  setMode(m);
                  if (m === "earnings") loadEarnings();
                }}
                style={[styles.segmentItem, mode === m && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
                  {m === "story" ? "Write" : m === "live" ? "Go live" : "Earnings"}
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

              <Text style={styles.overline}>ATTACHMENTS</Text>
              <View style={styles.attachRow}>
                <Pressable testID="reporter-attach-image" onPress={() => attachMedia("image")} style={styles.attachBtn}>
                  <Icon name="image-outline" color={C.red} size={18} />
                  <Text style={styles.attachText}>Photo</Text>
                </Pressable>
                <Pressable testID="reporter-attach-video" onPress={() => attachMedia("video")} style={styles.attachBtn}>
                  <Icon name="videocam-outline" color={C.red} size={18} />
                  <Text style={styles.attachText}>Video</Text>
                </Pressable>
              </View>

              {attachments.map((a) => (
                <View key={a.local_uri} style={styles.attachTile}>
                  <View style={styles.attachThumb}>
                    <Icon name={a.kind === "image" ? "image" : "film"} color={C.surface} size={18} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.attachTileName} numberOfLines={1}>{a.local_uri.split("/").pop()}</Text>
                    <Text style={[styles.attachTileStatus, a.status === "error" && { color: C.red }, a.status === "ready" && { color: C.green }]}>
                      {a.status === "uploading" && "Uploading to Mux…"}
                      {a.status === "processing" && "Processing…"}
                      {a.status === "ready" && "Ready ✓"}
                      {a.status === "error" && "Failed"}
                    </Text>
                  </View>
                  <Pressable testID={`reporter-remove-${a.local_uri}`} onPress={() => removeAttachment(a.local_uri)} style={styles.iconBtn}>
                    <Icon name="close" color={C.muted} size={18} />
                  </Pressable>
                </View>
              ))}

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
                      {p.media?.length ? (
                        <View style={{ marginTop: 10, gap: 8 }}>
                          {p.media.map((m, idx) => (
                            <MediaPlayer key={`${p.id}-m-${idx}`} media={m} radius={4} />
                          ))}
                        </View>
                      ) : null}
                    </View>
                    <Pressable testID={`reporter-delete-${p.id}`} onPress={() => deletePost(p.id)} style={styles.iconBtn}>
                      <Icon name="trash-outline" color={C.red} size={17} />
                    </Pressable>
                  </View>
                ))
              )}
            </>
          ) : mode === "live" ? (
            <>
              <Text style={styles.title}>Go live, stay connected.</Text>

              {connection ? (
                <>
                  <LiveStage track={localVideoTrack} label={`LIVE · ${sessionMeta?.room?.slice(-6).toUpperCase() || ""}`} />
                  <Text style={styles.helperText}>
                    Your camera and mic are streaming to LiveKit. Share the room code with readers or check the Live tab.
                  </Text>
                  <Button testID="reporter-end-live-button" onPress={endLive} tone="outline">
                    End broadcast
                  </Button>
                </>
              ) : (
                <>
                  <View style={styles.cameraPlaceholder}>
                    <Icon name="radio-outline" color={C.surface} size={38} />
                    <Text style={styles.previewText}>Ready to broadcast</Text>
                    <Text style={styles.previewSub}>
                      Tap Start to request camera + mic and open a LiveKit room. Readers see it instantly under Live now.
                    </Text>
                  </View>

                  <TextInput
                    testID="reporter-live-title"
                    value={title}
                    onChangeText={setTitle}
                    placeholder="Stream title (e.g. Live from the factory gate)"
                    placeholderTextColor="#8A8F91"
                    style={styles.inputTitle}
                  />

                  <Button testID="reporter-go-live-button" onPress={goLive} tone="red" loading={busy}>
                    Start live stream
                  </Button>

                  <View style={styles.notice}>
                    <Icon name="shield-checkmark-outline" color={C.blue} size={17} />
                    <Text style={styles.noticeText}>
                      Broadcasting uses WebRTC. In the web preview it publishes from your browser. On a phone you'll need a dev build (Publish → Generate build) for native WebRTC.
                    </Text>
                  </View>
                </>
              )}
            </>
          ) : (
            <>
              <Text style={styles.title}>Your support wall.</Text>
              <View style={styles.earningsGrid}>
                <EarningTile label="LIFETIME ₹" value={earnings?.lifetime ?? "—"} tone={C.green} />
                <EarningTile label="SUPPORTERS" value={earnings?.verified_count ?? "—"} />
                <EarningTile label="MONTHLY PLEDGES" value={earnings?.monthly_pledges ?? "—"} tone={C.red} />
                <EarningTile label="PENDING ₹" value={earnings?.pending_amount ?? "—"} />
              </View>

              <Text style={[styles.overline, { marginTop: 22, marginBottom: 10 }]}>TOP SUPPORTERS</Text>
              {earnings?.top_supporters?.length ? (
                earnings.top_supporters.map((s, idx) => (
                  <View key={s.supporter_id} style={styles.supporterRow}>
                    <View style={styles.supporterRank}>
                      <Text style={styles.supporterRankText}>{idx + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.supporterName}>{s.name}</Text>
                      <Text style={styles.postRowMeta}>{s.count} payment{s.count > 1 ? "s" : ""}</Text>
                    </View>
                    <Text style={styles.supporterTotal}>₹{s.total}</Text>
                  </View>
                ))
              ) : (
                <EmptyState
                  title="No supporters yet."
                  body="Once readers back you, you'll see them ranked here — and every ₹7 rolls up to your lifetime total."
                  icon="heart-outline"
                />
              )}

              <View style={styles.notice}>
                <Icon name="information-circle-outline" color={C.blue} size={17} />
                <Text style={styles.noticeText}>
                  Payouts run automatically through Razorpay once you add your bank details. Verified support totals update the moment a payment clears.
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

function EarningTile({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <View style={styles.earningTile}>
      <Text style={[styles.earningValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.earningLabel}>{label}</Text>
    </View>
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
  attachRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  attachBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: C.surface,
  },
  attachText: { color: C.ink, fontSize: 12, fontWeight: "800" },
  attachTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    padding: 10,
    marginBottom: 8,
    borderRadius: 6,
  },
  attachThumb: {
    width: 42,
    height: 42,
    backgroundColor: C.dark,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
  },
  attachTileName: { color: C.ink, fontSize: 13, fontWeight: "700" },
  attachTileStatus: { color: C.muted, fontSize: 11, marginTop: 3 },
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
  postRowMeta: { color: C.muted, fontSize: 11, marginTop: 3 },
  iconBtn: { padding: 8 },
  cameraPlaceholder: {
    height: 220,
    backgroundColor: C.dark,
    marginBottom: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 20,
  },
  previewText: { color: C.surface, fontWeight: "800", fontSize: 17 },
  previewSub: { color: "#B7BEC5", fontSize: 12, textAlign: "center", lineHeight: 18 },
  helperText: { color: C.muted, fontSize: 12, marginTop: 12, marginBottom: 8, lineHeight: 18 },
  earningsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 8,
  },
  earningTile: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    padding: 14,
    borderRadius: 6,
  },
  earningValue: { color: C.ink, fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  earningLabel: { color: C.muted, fontSize: 10, letterSpacing: 1, marginTop: 6, fontWeight: "800" },
  supporterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    padding: 12,
    borderRadius: 6,
    marginBottom: 8,
  },
  supporterRank: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  supporterRankText: { color: C.ink, fontWeight: "800", fontSize: 13 },
  supporterName: { color: C.ink, fontWeight: "800", fontSize: 14 },
  supporterTotal: { color: C.green, fontSize: 15, fontWeight: "800" },
});
