// Reader / client home: dispatch wall with an All / Following tab switch,
// live-now strip, inline Mux media, ₹7 Razorpay support (one-time or monthly),
// and a "flag for moderation" flow.
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
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
import { MediaPlayer, type MediaAttachment } from "@/src/media-player";
import { RazorpayCheckout, type CheckoutOrder } from "@/src/razorpay";
import { ReaderMenu } from "@/src/reader-menu";
import { SupportChoiceSheet, type SupportInterval } from "@/src/support-choice";
import { C } from "@/src/theme";
import { Button, EmptyState, Icon, Toast } from "@/src/ui";

type Post = {
  id: string;
  reporter_id: string;
  reporter_name: string;
  verified: boolean;
  title: string;
  body: string;
  kind: string;
  location: string;
  stats: string;
  media?: MediaAttachment[];
  trending_score?: number;
  reads_24h?: number;
};
type Reporter = {
  id: string;
  name: string;
  beat: string;
  location: string;
  followers: number;
  support_total?: number;
  verified: boolean;
};
type LiveSession = {
  id: string;
  room: string;
  title: string;
  reporter_id: string;
  reporter_name: string;
};

const CATEGORIES = ["All", "Field report", "Photo essay", "Dispatch"];

export default function Feed() {
  const router = useRouter();
  const { user } = useAuth();
  const [tab, setTab] = useState<"all" | "following" | "trending">("all");
  const [allPosts, setAllPosts] = useState<Post[]>([]);
  const [followingPosts, setFollowingPosts] = useState<Post[]>([]);
  const [trendingPosts, setTrendingPosts] = useState<Post[]>([]);
  const [bookmarkIds, setBookmarkIds] = useState<Set<string>>(new Set());
  const [reporters, setReporters] = useState<Reporter[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [category, setCategory] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);
  const [reporting, setReporting] = useState<Post | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [supportTarget, setSupportTarget] = useState<{ id: string; name: string } | null>(null);
  const [checkout, setCheckout] = useState<{ order: CheckoutOrder; reporterName: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, r, live, following, trending, bookmarks] = await Promise.all([
        apiGet<Post[]>("/feed"),
        apiGet<Reporter[]>("/reporters"),
        apiGet<LiveSession[]>("/live/sessions"),
        apiGet<Post[]>("/feed/following").catch(() => [] as Post[]),
        apiGet<Post[]>("/feed/trending").catch(() => [] as Post[]),
        apiGet<{ post_ids: string[] }>("/bookmarks").catch(() => ({ post_ids: [] as string[] })),
      ]);
      setAllPosts(p);
      setReporters(r);
      setLiveSessions(live);
      setFollowingPosts(following);
      setTrendingPosts(trending);
      setBookmarkIds(new Set(bookmarks.post_ids));
    } catch {
      setToast({ message: "Could not load the dispatch wall.", tone: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Record a read for the top-most posts so trending reflects real engagement.
  const seenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentPosts = tab === "following" ? followingPosts : tab === "trending" ? trendingPosts : allPosts;
    const toMark = currentPosts.slice(0, 6).filter((p) => !seenRef.current.has(p.id));
    toMark.forEach((p) => {
      seenRef.current.add(p.id);
      apiPost(`/posts/${p.id}/read`).catch(() => {
        /* trending is best-effort */
      });
    });
  }, [tab, allPosts, followingPosts, trendingPosts]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const toggleBookmark = async (post: Post) => {
    const isSaved = bookmarkIds.has(post.id);
    // Optimistic update.
    setBookmarkIds((prev) => {
      const next = new Set(prev);
      isSaved ? next.delete(post.id) : next.add(post.id);
      return next;
    });
    try {
      if (isSaved) await apiDelete(`/bookmarks/${post.id}`);
      else await apiPost("/bookmarks", { post_id: post.id });
      setToast({
        message: isSaved ? "Removed from your reading list." : "Saved to your reading list.",
        tone: isSaved ? "info" : "success",
      });
    } catch {
      // Roll back on failure.
      setBookmarkIds((prev) => {
        const next = new Set(prev);
        isSaved ? next.add(post.id) : next.delete(post.id);
        return next;
      });
      setToast({ message: "Bookmark action failed.", tone: "error" });
    }
  };

  const openSupport = (reporter: { id: string; name?: string }) => {
    setSupportTarget({ id: reporter.id, name: reporter.name || "this reporter" });
  };

  const startCheckout = async (interval: SupportInterval) => {
    if (!supportTarget) return;
    try {
      const order = await apiPost<CheckoutOrder>("/support", {
        reporter_id: supportTarget.id,
        amount: 7,
        interval,
      });
      setCheckout({ order, reporterName: supportTarget.name });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Support could not be started.";
      setToast({ message, tone: e instanceof ApiError && e.status === 503 ? "info" : "error" });
    } finally {
      setSupportTarget(null);
    }
  };

  const submitReport = async () => {
    if (!reporting || reportReason.trim().length < 3) {
      setToast({ message: "Tell us briefly what's wrong.", tone: "error" });
      return;
    }
    try {
      await apiPost("/reports", { post_id: reporting.id, reason: reportReason.trim() });
      setReporting(null);
      setReportReason("");
      setToast({ message: "Report sent to moderators.", tone: "success" });
    } catch {
      setToast({ message: "Report could not be sent.", tone: "error" });
    }
  };

  const sourcePosts =
    tab === "following" ? followingPosts : tab === "trending" ? trendingPosts : allPosts;
  const filtered =
    category === 0 || tab === "trending"
      ? sourcePosts
      : sourcePosts.filter((p) => p.kind.toLowerCase() === CATEGORIES[category].toLowerCase());

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.wordmark}>freepress</Text>
          <Text style={styles.kicker}>THE DISPATCH WALL</Text>
        </View>
        <Pressable testID="reader-menu-button" onPress={() => setMenuOpen(true)} style={styles.avatar}>
          <Icon name="ellipsis-horizontal" color={C.surface} size={19} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.red} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.red} />}
        >
          <Text style={styles.hello}>Hey {user?.name?.split(" ")[0] || "there"}.</Text>
          <Text style={styles.headline}>Today's ground truth.</Text>

          <View style={styles.tabRow}>
            {(["all", "following", "trending"] as const).map((t) => (
              <Pressable
                key={t}
                testID={`feed-tab-${t}`}
                onPress={() => setTab(t)}
                style={[styles.tab, tab === t && styles.tabActive]}
              >
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                  {t === "all" ? "All" : t === "following" ? `Following · ${followingPosts.length}` : "Trending"}
                </Text>
              </Pressable>
            ))}
          </View>

          {liveSessions.length ? (
            <View style={styles.liveStrip}>
              <View style={styles.liveStripHeader}>
                <View style={styles.liveDot} />
                <Text style={styles.liveStripLabel}>LIVE NOW · {liveSessions.length}</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {liveSessions.map((s) => (
                  <Pressable
                    key={s.id}
                    testID={`live-tile-${s.room}`}
                    onPress={() =>
                      router.push({
                        pathname: "/(reader)/live/[room]",
                        params: { room: s.room, title: s.title, reporter: s.reporter_name },
                      })
                    }
                    style={styles.liveTile}
                  >
                    <View style={styles.liveTilePill}>
                      <View style={styles.liveDot} />
                      <Text style={styles.liveTilePillText}>LIVE</Text>
                    </View>
                    <Text style={styles.liveTileTitle} numberOfLines={2}>{s.title}</Text>
                    <Text style={styles.liveTileMeta}>{s.reporter_name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {CATEGORIES.map((c, i) => (
              <Pressable
                key={c}
                testID={`feed-chip-${i}`}
                onPress={() => setCategory(i)}
                style={[styles.chip, i === category && styles.chipActive]}
              >
                <Text style={[styles.chipText, i === category && styles.chipTextActive]}>{c}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {filtered.length === 0 ? (
            <EmptyState
              title={tab === "following" ? "You're not following anyone yet." : "Nothing here yet."}
              body={
                tab === "following"
                  ? "Tap a reporter's byline to open their profile and follow them."
                  : "Check back soon — new dispatches drop throughout the day."
              }
              icon="newspaper-outline"
            />
          ) : (
            filtered.map((post, i) => (
              <View key={post.id} testID="reader-feed-item" style={[styles.post, i === 0 && styles.leadPost]}>
                <View style={styles.postTop}>
                  <Text style={[styles.postOverline, post.kind === "live now" && { color: C.red }]}>
                    {post.kind.toUpperCase()}
                  </Text>
                  {tab === "trending" && post.reads_24h ? (
                    <View style={styles.trendingBadge}>
                      <Icon name="flame" color={C.red} size={12} />
                      <Text style={styles.trendingBadgeText}>{post.reads_24h} reads · 24h</Text>
                    </View>
                  ) : (
                    <Text style={[styles.meta, i === 0 && { color: "#B7BEC5" }]}>{post.location}</Text>
                  )}
                </View>
                <Text style={[styles.postTitle, i === 0 && styles.leadTitle]}>{post.title}</Text>
                <Text style={[styles.postBody, i === 0 && styles.leadBody]}>{post.body}</Text>

                {post.media?.length ? (
                  <View style={styles.mediaStack}>
                    {post.media.map((m, idx) => (
                      <MediaPlayer key={`${post.id}-${idx}`} media={m} />
                    ))}
                  </View>
                ) : null}

                <View style={styles.postFooter}>
                  <Pressable
                    testID={`reader-open-reporter-${post.reporter_id}`}
                    onPress={() =>
                      router.push({ pathname: "/(reader)/reporter/[id]", params: { id: post.reporter_id } })
                    }
                  >
                    <Text style={[styles.byline, i === 0 && { color: C.surface }]}>
                      By {post.reporter_name}{" "}
                      {post.verified ? <Icon name="checkmark-circle" size={13} color={C.blue} /> : null}
                    </Text>
                  </Pressable>
                  <Text style={[styles.meta, i === 0 && { color: "#B7BEC5" }]}>{post.stats}</Text>
                </View>
                <View style={[styles.actions, i === 0 && { borderTopColor: "#2E353D" }]}>
                  <Pressable
                    testID="reader-support-button"
                    onPress={() => openSupport({ id: post.reporter_id, name: post.reporter_name })}
                    style={styles.action}
                  >
                    <Icon name="heart-outline" color={i === 0 ? C.surface : C.red} size={18} />
                    <Text style={[styles.actionText, i === 0 && { color: C.surface }]}>Support ₹7</Text>
                  </Pressable>
                  <Pressable
                    testID={`reader-bookmark-${post.id}`}
                    onPress={() => toggleBookmark(post)}
                    style={styles.action}
                  >
                    <Icon
                      name={bookmarkIds.has(post.id) ? "bookmark" : "bookmark-outline"}
                      color={i === 0 ? C.surface : bookmarkIds.has(post.id) ? C.blue : C.muted}
                      size={18}
                    />
                    <Text style={[styles.actionText, i === 0 && { color: C.surface }]}>
                      {bookmarkIds.has(post.id) ? "Saved" : "Save"}
                    </Text>
                  </Pressable>
                  <Pressable
                    testID="reader-report-button"
                    onPress={() => setReporting(post)}
                    style={styles.action}
                  >
                    <Icon name="flag-outline" color={i === 0 ? C.surface : C.muted} size={18} />
                    <Text style={[styles.actionText, i === 0 && { color: C.surface }]}>Flag</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}

          <View style={styles.reporterBlock}>
            <Text style={styles.overline}>FIND YOUR REPORTER</Text>
            <Text style={styles.blockHeading}>Support the work, not the noise.</Text>
            {reporters.length === 0 ? (
              <Text style={styles.meta}>No reporters yet. Invite one to join.</Text>
            ) : (
              reporters.map((r) => (
                <Pressable
                  key={r.id}
                  testID={`reader-open-reporter-card-${r.id}`}
                  onPress={() => router.push({ pathname: "/(reader)/reporter/[id]", params: { id: r.id } })}
                  style={styles.reporterRow}
                >
                  <View style={styles.reporterMark}>
                    <Text style={styles.reporterInitial}>{r.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reporterName}>
                      {r.name}{" "}
                      {r.verified ? <Icon name="checkmark-circle" size={13} color={C.blue} /> : null}
                    </Text>
                    <Text style={styles.meta}>
                      {r.beat} · {r.followers} follower{r.followers === 1 ? "" : "s"}
                      {r.support_total ? ` · ₹${r.support_total} supported` : ""}
                    </Text>
                  </View>
                  <Pressable
                    testID="support-seven-rupees-button"
                    onPress={(e) => {
                      e.stopPropagation?.();
                      openSupport(r);
                    }}
                    style={styles.supportSmall}
                  >
                    <Text style={styles.supportSmallText}>₹7</Text>
                  </Pressable>
                </Pressable>
              ))
            )}
          </View>
        </ScrollView>
      )}

      <Modal visible={!!reporting} transparent animationType="slide" onRequestClose={() => setReporting(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.overline}>FLAG DISPATCH</Text>
            <Text style={styles.blockHeading}>What's wrong with this post?</Text>
            <TextInput
              testID="report-reason-input"
              value={reportReason}
              onChangeText={setReportReason}
              placeholder="Give moderators enough context to review"
              placeholderTextColor="#8A8F91"
              multiline
              style={styles.reportInput}
            />
            <Button testID="report-submit-button" onPress={submitReport} tone="red">
              Send to moderators
            </Button>
            <Button
              onPress={() => {
                setReporting(null);
                setReportReason("");
              }}
              tone="outline"
            >
              Cancel
            </Button>
          </View>
        </View>
      </Modal>

      <SupportChoiceSheet
        visible={!!supportTarget}
        reporterName={supportTarget?.name || ""}
        onDismiss={() => setSupportTarget(null)}
        onChoose={startCheckout}
      />

      <ReaderMenu visible={menuOpen} onClose={() => setMenuOpen(false)} />

      <RazorpayCheckout
        visible={!!checkout}
        order={checkout?.order || null}
        reporterName={checkout?.reporterName || ""}
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
  wordmark: { color: C.ink, fontSize: 22, fontWeight: "800", letterSpacing: -1 },
  kicker: { fontSize: 9, letterSpacing: 2, color: C.muted, marginTop: 4, fontWeight: "800" },
  avatar: { backgroundColor: C.ink, borderRadius: 20, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingBottom: 60 },
  hello: { color: C.muted, fontSize: 13, fontWeight: "700" },
  headline: { color: C.ink, fontSize: 32, fontWeight: "800", letterSpacing: -1, marginTop: 4, marginBottom: 16 },
  tabRow: { flexDirection: "row", backgroundColor: C.line, padding: 3, borderRadius: 8, marginBottom: 18 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 6 },
  tabActive: { backgroundColor: C.surface },
  tabText: { color: C.muted, fontWeight: "800", fontSize: 12 },
  tabTextActive: { color: C.ink },
  liveStrip: { marginBottom: 20 },
  liveStripHeader: { flexDirection: "row", gap: 6, alignItems: "center", marginBottom: 10 },
  liveStripLabel: { color: C.red, fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  liveDot: { backgroundColor: C.red, width: 8, height: 8, borderRadius: 4 },
  liveTile: {
    width: 220,
    backgroundColor: C.ink,
    padding: 14,
    borderRadius: 8,
    gap: 8,
    flexShrink: 0,
  },
  liveTilePill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  liveTilePillText: { color: C.surface, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  liveTileTitle: { color: C.surface, fontSize: 15, fontWeight: "800", lineHeight: 20 },
  liveTileMeta: { color: "#B7BEC5", fontSize: 11 },
  chipRow: { gap: 8, paddingRight: 20 },
  chip: {
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 14,
    height: 36,
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: C.surface,
    flexShrink: 0,
  },
  chipActive: { backgroundColor: C.ink, borderColor: C.ink },
  chipText: { color: C.muted, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: C.surface },
  post: {
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingVertical: 20,
    marginTop: 12,
    paddingHorizontal: 16,
  },
  leadPost: { backgroundColor: C.ink, borderTopWidth: 0, padding: 20, marginTop: 20, borderRadius: 6 },
  postTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  postOverline: { color: C.muted, fontSize: 10, letterSpacing: 1.6, fontWeight: "800" },
  trendingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F5E5E2",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  trendingBadgeText: { color: C.red, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  overline: { color: C.muted, fontSize: 11, letterSpacing: 1.5, fontWeight: "800" },
  postTitle: { color: C.ink, fontSize: 22, lineHeight: 26, fontWeight: "800", letterSpacing: -0.5 },
  leadTitle: { color: C.surface, fontSize: 28, lineHeight: 30 },
  postBody: { color: C.muted, fontSize: 15, lineHeight: 22, marginTop: 10 },
  leadBody: { color: "#B7BEC5" },
  mediaStack: { gap: 10, marginTop: 14 },
  postFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 18, alignItems: "center" },
  byline: { color: C.ink, fontSize: 13, fontWeight: "700" },
  meta: { color: C.muted, fontSize: 12 },
  actions: { flexDirection: "row", gap: 20, marginTop: 16, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 12 },
  action: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionText: { color: C.muted, fontSize: 12, fontWeight: "700" },
  reporterBlock: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    padding: 18,
    marginTop: 24,
    borderRadius: 6,
  },
  blockHeading: { color: C.ink, fontSize: 20, fontWeight: "800", marginTop: 8, marginBottom: 4 },
  reporterRow: { flexDirection: "row", alignItems: "center", marginTop: 16 },
  reporterMark: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.dark,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  reporterInitial: { color: C.surface, fontWeight: "800" },
  reporterName: { color: C.ink, fontWeight: "800", fontSize: 14 },
  supportSmall: {
    borderWidth: 1,
    borderColor: C.red,
    paddingHorizontal: 14,
    height: 34,
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: C.paper,
  },
  supportSmallText: { color: C.red, fontSize: 12, fontWeight: "800" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(24,32,42,0.55)", justifyContent: "flex-end" },
  modal: { backgroundColor: C.surface, padding: 22, paddingBottom: 32, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  reportInput: {
    color: C.ink,
    backgroundColor: C.paper,
    borderWidth: 1,
    borderColor: C.line,
    padding: 14,
    minHeight: 120,
    fontSize: 14,
    marginTop: 12,
    marginBottom: 12,
    textAlignVertical: "top",
    borderRadius: 6,
  },
});
