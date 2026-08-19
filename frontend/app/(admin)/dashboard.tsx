// Admin dashboard: metrics, moderation queue, user directory with disable /
// enable / verify actions. Every destructive action goes through a confirm
// sheet — no silent takedowns.
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { apiGet, apiPost, ApiError } from "@/src/api";
import { useAuth } from "@/src/auth";
import { C } from "@/src/theme";
import { Button, EmptyState, Icon, Toast } from "@/src/ui";

type Overview = {
  users: number;
  reporters: number;
  posts: number;
  open_reports: number;
  live_now: number;
  queue: {
    id: string;
    post_id: string;
    reason: string;
    note: string;
    reporter_name: string;
    created_at: string;
    status: string;
  }[];
};
type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  disabled?: boolean;
  verified?: boolean;
  created_at: string;
};

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<"queue" | "users">("queue");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selected, setSelected] = useState<Overview["queue"][number] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, u] = await Promise.all([apiGet<Overview>("/admin/overview"), apiGet<AdminUser[]>("/admin/users")]);
      setOverview(o);
      setUsers(u);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Could not load admin data.";
      setToast({ message, tone: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const resolveReport = async () => {
    if (!selected) return;
    try {
      await apiPost(`/reports/${selected.id}/resolve`);
      setSelected(null);
      setToast({ message: "Report resolved · audit entry created.", tone: "success" });
      await load();
    } catch {
      setToast({ message: "Could not resolve the report.", tone: "error" });
    }
  };

  const toggleUser = async (u: AdminUser) => {
    try {
      await apiPost(`/admin/users/${u.id}/${u.disabled ? "enable" : "disable"}`);
      setToast({
        message: u.disabled ? `${u.name} re-enabled.` : `${u.name} disabled.`,
        tone: "success",
      });
      await load();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Action failed.";
      setToast({ message, tone: "error" });
    }
  };

  const verifyUser = async (u: AdminUser) => {
    try {
      await apiPost(`/admin/users/${u.id}/verify`);
      setToast({ message: `${u.name} verified.`, tone: "success" });
      await load();
    } catch {
      setToast({ message: "Could not verify user.", tone: "error" });
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

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.wordmark}>freepress</Text>
          <Text style={styles.kicker}>TRUST & SAFETY</Text>
        </View>
        <Pressable testID="admin-logout-button" onPress={logout} style={styles.avatar}>
          <Icon name="log-out-outline" color={C.surface} size={19} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.red} />}
      >
        <Text style={styles.hello}>Hey {user?.name}.</Text>
        <Text style={styles.headline}>Accountability desk.</Text>

        <View style={styles.metrics}>
          <Metric label="USERS" value={overview?.users ?? "—"} />
          <Metric label="REPORTERS" value={overview?.reporters ?? "—"} />
          <Metric label="POSTS" value={overview?.posts ?? "—"} />
          <Metric label="OPEN FLAGS" value={overview?.open_reports ?? "—"} tone={overview && overview.open_reports > 0 ? C.red : undefined} />
        </View>

        <View style={styles.segment}>
          {(["queue", "users"] as const).map((t) => (
            <Pressable
              key={t}
              testID={`admin-tab-${t}`}
              onPress={() => setTab(t)}
              style={[styles.segmentItem, tab === t && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, tab === t && styles.segmentTextActive]}>
                {t === "queue" ? `Moderation · ${overview?.queue?.length ?? 0}` : `Users · ${users.length}`}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === "queue" ? (
          overview?.queue?.length ? (
            overview.queue.map((item) => (
              <Pressable
                testID="admin-moderation-queue"
                key={item.id}
                onPress={() => setSelected(item)}
                style={styles.queueItem}
              >
                <View style={styles.severity}>
                  <Icon name="flag-outline" color={C.red} size={18} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.queueReason}>{item.reason}</Text>
                  <Text style={styles.meta}>
                    Post {item.post_id.slice(0, 8)} · flagged by {item.reporter_name}
                  </Text>
                  {item.note ? <Text style={styles.queueNote}>{item.note}</Text> : null}
                </View>
                <Text style={styles.queueStatus}>{item.status}</Text>
              </Pressable>
            ))
          ) : (
            <EmptyState
              title="Clear queue."
              body="No reports need your attention. Transparent moderation keeps trust visible."
              icon="checkmark-done-outline"
            />
          )
        ) : (
          <>
            {users.map((u) => (
              <View key={u.id} testID={`admin-user-${u.role}`} style={styles.userRow}>
                <View style={styles.userMark}>
                  <Text style={styles.userInitial}>{u.name[0]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Text style={styles.userName}>{u.name}</Text>
                    {u.verified ? <Icon name="checkmark-circle" color={C.blue} size={13} /> : null}
                    {u.disabled ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>DISABLED</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.meta}>
                    {u.email} · {u.role.toUpperCase()}
                  </Text>
                </View>
                <View style={styles.userActions}>
                  {u.role === "reporter" && !u.verified ? (
                    <Pressable testID={`admin-verify-${u.id}`} onPress={() => verifyUser(u)} style={styles.iconBtn}>
                      <Icon name="checkmark-circle-outline" color={C.blue} size={20} />
                    </Pressable>
                  ) : null}
                  {u.id !== user?.id ? (
                    <Pressable testID={`admin-toggle-${u.id}`} onPress={() => toggleUser(u)} style={styles.iconBtn}>
                      <Icon name={u.disabled ? "power-outline" : "ban-outline"} color={u.disabled ? C.green : C.red} size={20} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
          </>
        )}

        <View style={styles.principles}>
          <Text style={styles.overline}>PLATFORM PRINCIPLES</Text>
          <Text style={styles.principleText}>No silent takedowns · evidence required · appeal always available</Text>
          <Text style={styles.principleMeta}>Every action creates an audit entry for the reporter and admin.</Text>
        </View>
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.overline}>REPORT DETAIL</Text>
            <Text style={styles.modalHeading}>Review with context.</Text>
            <Text style={styles.modalReason}>{selected?.reason}</Text>
            {selected?.note ? <Text style={styles.modalNote}>{selected.note}</Text> : null}
            <Text style={styles.meta}>
              Post {selected?.post_id.slice(0, 8)} · flagged by {selected?.reporter_name}
            </Text>
            <Button testID="admin-resolve-report-button" onPress={resolveReport} tone="red">
              Resolve report
            </Button>
            <Button onPress={() => setSelected(null)} tone="outline">
              Keep open
            </Button>
          </View>
        </View>
      </Modal>

      {toast ? <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} /> : null}
    </SafeAreaView>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricNumber, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
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
    justifyContent: "space-between",
  },
  wordmark: { color: C.ink, fontSize: 22, fontWeight: "800", letterSpacing: -1 },
  kicker: { fontSize: 9, letterSpacing: 2, color: C.muted, marginTop: 4, fontWeight: "800" },
  avatar: { backgroundColor: C.ink, borderRadius: 20, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingBottom: 60 },
  hello: { color: C.muted, fontSize: 13, fontWeight: "700" },
  headline: { color: C.ink, fontSize: 30, fontWeight: "800", letterSpacing: -1, marginTop: 4, marginBottom: 20 },
  metrics: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.line,
    marginBottom: 20,
    backgroundColor: C.surface,
  },
  metric: { flex: 1, paddingVertical: 14, paddingHorizontal: 10, borderRightWidth: 1, borderColor: C.line },
  metricNumber: { fontSize: 22, fontWeight: "800", color: C.ink, letterSpacing: -0.5 },
  metricLabel: { color: C.muted, fontSize: 9, letterSpacing: 1, marginTop: 4, fontWeight: "800" },
  segment: { flexDirection: "row", backgroundColor: C.line, padding: 3, borderRadius: 8, marginBottom: 18 },
  segmentItem: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 6 },
  segmentActive: { backgroundColor: C.surface },
  segmentText: { color: C.muted, fontWeight: "800", fontSize: 12 },
  segmentTextActive: { color: C.ink },
  queueItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderColor: C.line,
    paddingVertical: 16,
  },
  severity: { width: 34, height: 34, backgroundColor: "#F5E5E2", alignItems: "center", justifyContent: "center", borderRadius: 4 },
  queueReason: { color: C.ink, fontWeight: "800", fontSize: 14 },
  queueNote: { color: C.muted, fontSize: 12, marginTop: 3, fontStyle: "italic" },
  queueStatus: { color: C.red, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  meta: { color: C.muted, fontSize: 12 },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderColor: C.line,
    paddingVertical: 14,
  },
  userMark: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.dark, alignItems: "center", justifyContent: "center" },
  userInitial: { color: C.surface, fontWeight: "800" },
  userName: { color: C.ink, fontWeight: "800", fontSize: 14 },
  userActions: { flexDirection: "row", gap: 6 },
  iconBtn: { padding: 8 },
  badge: { backgroundColor: C.red, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 },
  badgeText: { color: C.surface, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  overline: { color: C.muted, fontSize: 11, letterSpacing: 1.5, fontWeight: "800" },
  principles: { borderTopWidth: 1, borderColor: C.line, paddingTop: 22, marginTop: 28 },
  principleText: { color: C.ink, fontSize: 16, lineHeight: 22, fontWeight: "700", marginTop: 10 },
  principleMeta: { color: C.muted, fontSize: 12, marginTop: 8 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(24,32,42,0.55)", justifyContent: "flex-end" },
  modal: { backgroundColor: C.surface, padding: 22, paddingBottom: 32, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  modalHeading: { color: C.ink, fontSize: 22, fontWeight: "800", marginTop: 8, marginBottom: 8 },
  modalReason: { color: C.ink, fontSize: 15, fontWeight: "700", marginBottom: 6 },
  modalNote: { color: C.muted, fontSize: 13, marginBottom: 12, fontStyle: "italic" },
});
