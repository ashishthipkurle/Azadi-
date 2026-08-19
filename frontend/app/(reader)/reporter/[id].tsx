// Reporter profile — shows bio, follower / support totals, follow toggle, all
// dispatches, and a one-tap ₹7 support entry point.
import { useLocalSearchParams, useRouter } from "expo-router";
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

import { apiDelete, apiGet, apiPost, ApiError } from "@/src/api";
import { useAuth } from "@/src/auth";
import { MediaPlayer, type MediaAttachment } from "@/src/media-player";
import { RazorpayCheckout, type CheckoutOrder } from "@/src/razorpay";
import { SupportChoiceSheet, type SupportInterval } from "@/src/support-choice";
import { C } from "@/src/theme";
import { Button, EmptyState, Icon, Toast } from "@/src/ui";

type ProfileResp = {
  reporter: {
    id: string;
    name: string;
    email: string;
    role: string;
    verified?: boolean;
    beat?: string;
    location?: string;
    followers: number;
    support_total: number;
    is_following: boolean;
  };
  posts: {
    id: string;
    title: string;
    body: string;
    kind: string;
    location: string;
    stats: string;
    created_at: string;
    media?: MediaAttachment[];
  }[];
};

export default function ReporterProfile() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [data, setData] = useState<ProfileResp | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);
  const [checkout, setCheckout] = useState<CheckoutOrder | null>(null);
  const [choosingInterval, setChoosingInterval] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<ProfileResp>(`/reporters/${id}`);
      setData(res);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Could not load this reporter.";
      setToast({ message, tone: "error" });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleFollow = async () => {
    if (!data) return;
    try {
      if (data.reporter.is_following) {
        const res = await apiDelete<{ followers: number }>(`/reporters/${id}/follow`);
        setData({ ...data, reporter: { ...data.reporter, is_following: false, followers: res.followers } });
      } else {
        const res = await apiPost<{ followers: number }>(`/reporters/${id}/follow`);
        setData({ ...data, reporter: { ...data.reporter, is_following: true, followers: res.followers } });
        setToast({ message: `Following ${data.reporter.name}.`, tone: "success" });
      }
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Follow action failed.";
      setToast({ message, tone: "error" });
    }
  };

  const startSupport = async (interval: SupportInterval) => {
    if (!data) return;
    setChoosingInterval(false);
    try {
      const order = await apiPost<CheckoutOrder>("/support", {
        reporter_id: data.reporter.id,
        amount: 7,
        interval,
      });
      setCheckout(order);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Support could not be started.";
      setToast({ message, tone: e instanceof ApiError && e.status === 503 ? "info" : "error" });
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={C.red} />
        </View>
      </SafeAreaView>
    );
  }

  if (!data) return null;
  const r = data.reporter;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable testID="profile-back" onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Icon name="chevron-back" color={C.ink} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>

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
        <View style={styles.top}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>{r.name[0]}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Text style={styles.name}>{r.name}</Text>
              {r.verified ? <Icon name="checkmark-circle" color={C.blue} size={16} /> : null}
            </View>
            <Text style={styles.beat}>{r.beat || "Independent reporting"}</Text>
            {r.location ? <Text style={styles.meta}>Based in {r.location}</Text> : null}
          </View>
        </View>

        <View style={styles.stats}>
          <Stat label="DISPATCHES" value={data.posts.length} />
          <Stat label="FOLLOWERS" value={r.followers} />
          <Stat label="₹ SUPPORTED" value={r.support_total} />
        </View>

        <View style={styles.actions}>
          {user?.role === "client" ? (
            <>
              <Pressable
                testID="profile-follow-toggle"
                onPress={toggleFollow}
                style={[styles.followBtn, r.is_following && styles.followingBtn]}
              >
                <Icon
                  name={r.is_following ? "checkmark" : "add"}
                  color={r.is_following ? C.ink : C.surface}
                  size={17}
                />
                <Text style={[styles.followBtnText, r.is_following && { color: C.ink }]}>
                  {r.is_following ? "Following" : "Follow"}
                </Text>
              </Pressable>
              <Pressable testID="profile-support-button" onPress={() => setChoosingInterval(true)} style={styles.supportBtn}>
                <Icon name="heart" color={C.surface} size={17} />
                <Text style={styles.supportBtnText}>Support ₹7</Text>
              </Pressable>
            </>
          ) : (
            <View style={{ flex: 1 }}>
              <Text style={styles.meta}>Sign in as a reader to follow or support this reporter.</Text>
            </View>
          )}
        </View>

        <Text style={styles.overline}>DISPATCHES</Text>
        {data.posts.length === 0 ? (
          <EmptyState title="No dispatches yet." body="This reporter hasn't published anything yet." icon="document-text-outline" />
        ) : (
          data.posts.map((p) => (
            <View key={p.id} style={styles.postCard}>
              <Text style={styles.postKind}>{p.kind.toUpperCase()}</Text>
              <Text style={styles.postTitle}>{p.title}</Text>
              <Text style={styles.postBody} numberOfLines={3}>{p.body}</Text>
              {p.media?.length ? (
                <View style={{ gap: 10, marginTop: 12 }}>
                  {p.media.map((m, idx) => (
                    <MediaPlayer key={`${p.id}-${idx}`} media={m} />
                  ))}
                </View>
              ) : null}
              <View style={styles.postFooter}>
                <Text style={styles.meta}>{p.location}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <SupportChoiceSheet
        visible={choosingInterval}
        reporterName={r.name}
        onDismiss={() => setChoosingInterval(false)}
        onChoose={startSupport}
      />

      <RazorpayCheckout
        visible={!!checkout}
        order={checkout}
        reporterName={r.name}
        userName={user?.name}
        userEmail={user?.email}
        onDismiss={() => setCheckout(null)}
        onResult={(res) => {
          setCheckout(null);
          setToast({ message: res.message, tone: res.ok ? "success" : "error" });
          if (res.ok) load();
        }}
      />

      {toast ? <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} /> : null}
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statNumber}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
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
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  backText: { color: C.ink, fontSize: 14, fontWeight: "700" },
  content: { padding: 20, paddingBottom: 60 },
  top: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: C.dark,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: { color: C.surface, fontSize: 26, fontWeight: "800" },
  name: { color: C.ink, fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  beat: { color: C.ink, fontSize: 13, fontWeight: "700", marginTop: 4 },
  meta: { color: C.muted, fontSize: 12, marginTop: 2 },
  stats: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.line,
    marginTop: 20,
    backgroundColor: C.surface,
  },
  stat: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRightWidth: 1,
    borderColor: C.line,
    alignItems: "center",
  },
  statNumber: { fontSize: 20, fontWeight: "800", color: C.ink, letterSpacing: -0.5 },
  statLabel: { color: C.muted, fontSize: 9, letterSpacing: 1, marginTop: 4, fontWeight: "800" },
  actions: { flexDirection: "row", gap: 10, marginTop: 20, marginBottom: 22 },
  followBtn: {
    flex: 1,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: C.ink,
    borderRadius: 6,
  },
  followingBtn: { backgroundColor: C.paper, borderWidth: 1, borderColor: C.line },
  followBtnText: { color: C.surface, fontWeight: "800", fontSize: 14 },
  supportBtn: {
    flex: 1,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: C.red,
    borderRadius: 6,
  },
  supportBtnText: { color: C.surface, fontWeight: "800", fontSize: 14 },
  overline: { color: C.muted, fontSize: 11, letterSpacing: 1.5, fontWeight: "800", marginBottom: 10 },
  postCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    padding: 16,
    marginBottom: 10,
    borderRadius: 6,
  },
  postKind: { color: C.muted, fontSize: 10, letterSpacing: 1.5, fontWeight: "800", marginBottom: 6 },
  postTitle: { color: C.ink, fontSize: 17, fontWeight: "800", marginBottom: 6 },
  postBody: { color: C.muted, fontSize: 13, lineHeight: 20 },
  postFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  mediaHint: { flexDirection: "row", alignItems: "center", gap: 4 },
  mediaHintText: { color: C.muted, fontSize: 11, fontWeight: "700" },
});
