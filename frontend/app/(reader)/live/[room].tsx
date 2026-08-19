// Reader live-stream viewer.
//
// Fetches a subscribe-only LiveKit token (POST /api/live/viewer-token),
// connects to the room, and renders the reporter's first remote video track
// via <LiveStage/>. Gracefully surfaces the "coming soon" toast if LiveKit
// keys aren't yet configured on the backend.
import type { RemoteVideoTrack, TrackPublication, Participant } from "livekit-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { apiPost, ApiError } from "@/src/api";
import { LiveStage } from "@/src/live-stage";
import { subscribeLive, type LiveConnection } from "@/src/livekit";
import { C } from "@/src/theme";
import { Button, Icon, Toast } from "@/src/ui";

export default function LiveRoom() {
  const router = useRouter();
  const { room, title, reporter } = useLocalSearchParams<{ room: string; title?: string; reporter?: string }>();
  const [connection, setConnection] = useState<LiveConnection | null>(null);
  const [track, setTrack] = useState<RemoteVideoTrack | null>(null);
  const [status, setStatus] = useState<"connecting" | "waiting" | "live" | "ended" | "error">("connecting");
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);
  const [viewers, setViewers] = useState(0);
  const disconnectRef = useRef<null | (() => Promise<void>)>(null);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        const tokenResp = await apiPost<{ token: string; url: string }>("/live/viewer-token", { room });
        if (cancelled) return;
        const conn = await subscribeLive({ url: tokenResp.url, token: tokenResp.token });
        if (cancelled) {
          await conn.disconnect();
          return;
        }
        setConnection(conn);
        setStatus("waiting");
        setViewers(conn.room.numParticipants);

        const onTrackSubscribed = (t: any, _pub: TrackPublication, _p: Participant) => {
          if (t.kind === "video") {
            setTrack(t);
            setStatus("live");
          }
        };
        const onTrackUnsubscribed = (t: any) => {
          if (t.kind === "video") {
            setTrack(null);
            setStatus("waiting");
          }
        };
        const onParticipant = () => setViewers(conn.room.numParticipants);
        const onDisconnected = () => setStatus("ended");

        // Attach any already-published video track.
        conn.room.remoteParticipants.forEach((rp) => {
          rp.videoTrackPublications.forEach((pub) => {
            if (pub.track) {
              setTrack(pub.track as RemoteVideoTrack);
              setStatus("live");
            }
          });
        });

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const lk = require("livekit-client");
        conn.room
          .on(lk.RoomEvent.TrackSubscribed, onTrackSubscribed)
          .on(lk.RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
          .on(lk.RoomEvent.ParticipantConnected, onParticipant)
          .on(lk.RoomEvent.ParticipantDisconnected, onParticipant)
          .on(lk.RoomEvent.Disconnected, onDisconnected);

        disconnectRef.current = conn.disconnect;
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        const message =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Could not join the live room.";
        setToast({ message, tone: e instanceof ApiError && e.status === 503 ? "info" : "error" });
      }
    };
    start();
    return () => {
      cancelled = true;
      if (disconnectRef.current) disconnectRef.current().catch(() => {});
    };
  }, [room]);

  const leave = async () => {
    if (disconnectRef.current) await disconnectRef.current();
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable testID="live-back" onPress={leave} hitSlop={12} style={styles.backBtn}>
          <Icon name="chevron-back" color={C.ink} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <View style={styles.viewersPill}>
          <Icon name="eye-outline" color={C.muted} size={13} />
          <Text style={styles.viewersText}>{viewers}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {status === "connecting" ? (
          <View style={styles.pending}>
            <ActivityIndicator color={C.red} />
            <Text style={styles.pendingText}>Connecting to the room…</Text>
          </View>
        ) : status === "waiting" ? (
          <View style={styles.pending}>
            <Icon name="radio-outline" color={C.muted} size={30} />
            <Text style={styles.pendingText}>Waiting for {reporter || "the reporter"} to start their camera.</Text>
          </View>
        ) : status === "ended" || status === "error" ? (
          <View style={styles.pending}>
            <Icon name="close-circle-outline" color={C.red} size={30} />
            <Text style={styles.pendingText}>
              {status === "ended" ? "This broadcast has ended." : "We couldn't connect to the room."}
            </Text>
            <Button onPress={leave} tone="outline">Go back</Button>
          </View>
        ) : (
          <LiveStage track={track} label="LIVE" />
        )}

        <View style={styles.details}>
          <Text style={styles.overline}>NOW LIVE</Text>
          <Text style={styles.title}>{title || "Field broadcast"}</Text>
          {reporter ? <Text style={styles.reporter}>Broadcasting by {reporter}</Text> : null}
          <Text style={styles.roomCode}>Room · {room?.slice(-8).toUpperCase()}</Text>
        </View>
      </ScrollView>

      {toast ? <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} /> : null}
    </SafeAreaView>
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
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  backText: { color: C.ink, fontSize: 14, fontWeight: "700" },
  viewersPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  viewersText: { color: C.muted, fontSize: 11, fontWeight: "700" },
  content: { padding: 20, paddingBottom: 60 },
  pending: {
    height: 260,
    backgroundColor: C.ink,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  pendingText: { color: C.surface, fontSize: 14, textAlign: "center", fontWeight: "700" },
  details: { marginTop: 20 },
  overline: { color: C.red, fontSize: 10, letterSpacing: 1.5, fontWeight: "800" },
  title: { color: C.ink, fontSize: 26, fontWeight: "800", letterSpacing: -0.5, marginTop: 8 },
  reporter: { color: C.ink, fontSize: 14, fontWeight: "700", marginTop: 6 },
  roomCode: { color: C.muted, fontSize: 12, marginTop: 12, fontFamily: "monospace" },
});
