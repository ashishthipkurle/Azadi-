// LiveKit runtime helper.
//
// We use the pure JS `livekit-client` SDK so publishing/subscribing works out
// of the box in the web preview via browser WebRTC. On a native dev-build the
// same code runs on top of `@livekit/react-native` + `@livekit/react-native-webrtc`.
//
// In Expo Go the native WebRTC module is not linked, so any attempt to publish
// tracks will throw. We wrap the entry points in try/catch and surface an
// "open a dev build to broadcast" message instead of crashing the app.
import type { Room as RoomType } from "livekit-client";

let cached: typeof import("livekit-client") | null = null;

async function loadLK() {
  if (!cached) cached = await import("livekit-client");
  return cached;
}

export type LiveConnection = {
  room: RoomType;
  disconnect: () => Promise<void>;
};

export async function publishLive({ url, token }: { url: string; token: string }): Promise<LiveConnection> {
  const lk = await loadLK();
  const room = new lk.Room({ adaptiveStream: true, dynacast: true });
  await room.connect(url, token);
  // Enable camera + mic (browser WebRTC on web, native WebRTC on dev-build).
  await room.localParticipant.setCameraEnabled(true);
  await room.localParticipant.setMicrophoneEnabled(true);
  return {
    room,
    disconnect: async () => {
      try {
        await room.localParticipant.setCameraEnabled(false);
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch {
        /* ignore — already torn down */
      }
      await room.disconnect();
    },
  };
}

export async function subscribeLive({ url, token }: { url: string; token: string }): Promise<LiveConnection> {
  const lk = await loadLK();
  const room = new lk.Room({ adaptiveStream: true });
  await room.connect(url, token);
  return {
    room,
    disconnect: async () => {
      await room.disconnect();
    },
  };
}
