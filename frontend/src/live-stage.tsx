// LiveStage: renders a LiveKit RemoteVideoTrack (subscriber) or LocalVideoTrack
// (publisher preview).
//
// On WEB it uses `track.attach(HTMLVideoElement)` — the browser handles WebRTC
// natively so this Just Works in the Expo web preview.
//
// On NATIVE we don't have a good way to render a LiveKit track without a
// dev-build (`@livekit/react-native`'s <VideoView> requires the native WebRTC
// module which is not present in Expo Go). We render an informative placeholder
// instead so the app never crashes; a real broadcast works after the reporter
// generates a build.
import type { LocalVideoTrack, RemoteVideoTrack } from "livekit-client";
import { useEffect, useRef } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { C } from "@/src/theme";
import { Icon } from "@/src/ui";

type AnyVideoTrack = LocalVideoTrack | RemoteVideoTrack | undefined | null;

export function LiveStage({ track, label }: { track: AnyVideoTrack; label: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el as unknown as HTMLMediaElement);
    return () => {
      try {
        track.detach(el as unknown as HTMLMediaElement);
      } catch {
        /* ignore */
      }
    };
  }, [track]);

  if (Platform.OS === "web") {
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <View style={styles.frame}>
        {/* @ts-expect-error — react-native-web passes through to a real <video> */}
        <video
          ref={ref as any}
          autoPlay
          playsInline
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover", background: "#20252B" }}
        />
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.livePillText}>{label}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.frame, styles.nativeFallback]}>
      <Icon name="videocam-outline" color={C.surface} size={30} />
      <Text style={styles.fallbackTitle}>Broadcast is running</Text>
      <Text style={styles.fallbackBody}>
        Video rendering on device needs a dev build. Open the web preview or generate a build to watch.
      </Text>
      <View style={styles.livePill}>
        <View style={styles.liveDot} />
        <Text style={styles.livePillText}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: 260,
    backgroundColor: C.dark,
    borderRadius: 8,
    overflow: "hidden",
    position: "relative",
  },
  nativeFallback: {
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    gap: 8,
  },
  fallbackTitle: { color: C.surface, fontWeight: "800", fontSize: 16 },
  fallbackBody: { color: "#B7BEC5", fontSize: 12, textAlign: "center", lineHeight: 18 },
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
});
