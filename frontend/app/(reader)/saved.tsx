// Saved dispatches — reader's private reading list.
// The bookmark list is fetched from the backend when online and cached
// locally via @/src/utils/storage so the reader can revisit their saved
// stories even without connectivity.
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { apiDelete, apiGet } from "@/src/api";
import { MediaPlayer, type MediaAttachment } from "@/src/media-player";
import { C } from "@/src/theme";
import { EmptyState, Icon, Toast } from "@/src/ui";
import { storage } from "@/src/utils/storage";

type SavedPost = {
  id: string;
  reporter_id: string;
  reporter_name: string;
  title: string;
  body: string;
  kind: string;
  location: string;
  media?: MediaAttachment[];
};

const CACHE_KEY = "freepress.bookmarks.cache";

export default function Saved() {
  const router = useRouter();
  const [posts, setPosts] = useState<SavedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ posts: SavedPost[] }>("/bookmarks");
      setPosts(res.posts);
      setOffline(false);
      await storage.setItem(CACHE_KEY, res.posts as any);
    } catch {
      // Fall back to whatever we cached locally.
      const cached = await storage.getItem<SavedPost[]>(CACHE_KEY, []);
      setPosts(Array.isArray(cached) ? cached : []);
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string) => {
    try {
      await apiDelete(`/bookmarks/${id}`);
      const next = posts.filter((p) => p.id !== id);
      setPosts(next);
      await storage.setItem(CACHE_KEY, next as any);
      setToast({ message: "Removed from your reading list.", tone: "info" });
    } catch {
      setToast({ message: "Could not remove — try again when you're online.", tone: "error" });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable testID="saved-back" onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Icon name="chevron-back" color={C.ink} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Saved</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.red} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              tintColor={C.red}
            />
          }
        >
          {offline ? (
            <View style={styles.offline}>
              <Icon name="cloud-offline-outline" color={C.muted} size={16} />
              <Text style={styles.offlineText}>Showing your last cached reading list — pull to retry.</Text>
            </View>
          ) : null}

          {posts.length === 0 ? (
            <EmptyState
              title="Nothing saved yet."
              body="Tap the bookmark icon on any dispatch to save it here for later."
              icon="bookmark-outline"
            />
          ) : (
            posts.map((p) => (
              <View key={p.id} testID={`saved-item-${p.id}`} style={styles.card}>
                <Text style={styles.kind}>{p.kind.toUpperCase()}</Text>
                <Text style={styles.postTitle}>{p.title}</Text>
                <Text style={styles.postBody} numberOfLines={3}>{p.body}</Text>
                {p.media?.length ? (
                  <View style={{ gap: 8, marginTop: 12 }}>
                    {p.media.map((m, idx) => (
                      <MediaPlayer key={`${p.id}-${idx}`} media={m} />
                    ))}
                  </View>
                ) : null}
                <View style={styles.cardFooter}>
                  <Pressable
                    testID={`saved-open-reporter-${p.reporter_id}`}
                    onPress={() =>
                      router.push({ pathname: "/(reader)/reporter/[id]", params: { id: p.reporter_id } })
                    }
                  >
                    <Text style={styles.byline}>By {p.reporter_name}</Text>
                  </Pressable>
                  <Pressable testID={`saved-remove-${p.id}`} onPress={() => remove(p.id)} style={styles.removeBtn}>
                    <Icon name="bookmark" color={C.red} size={16} />
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {toast ? <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, width: 60 },
  backText: { color: C.ink, fontSize: 14, fontWeight: "700" },
  title: { color: C.ink, fontSize: 18, fontWeight: "800" },
  content: { padding: 20, paddingBottom: 60 },
  offline: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    backgroundColor: "#EFEBDF",
    padding: 10,
    marginBottom: 14,
    borderRadius: 6,
  },
  offlineText: { color: C.muted, fontSize: 12, flex: 1 },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    padding: 16,
    marginBottom: 12,
    borderRadius: 6,
  },
  kind: { color: C.muted, fontSize: 10, letterSpacing: 1.5, fontWeight: "800", marginBottom: 6 },
  postTitle: { color: C.ink, fontSize: 18, fontWeight: "800", lineHeight: 24 },
  postBody: { color: C.muted, fontSize: 14, lineHeight: 20, marginTop: 6 },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  byline: { color: C.ink, fontSize: 13, fontWeight: "700" },
  removeBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  removeText: { color: C.red, fontSize: 12, fontWeight: "800" },
});
