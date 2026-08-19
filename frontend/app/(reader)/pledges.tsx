// Manage-my-pledges — a reader can pause or cancel any monthly ₹7 support in
// one tap. Uses POST /api/support/pledges/{id}/cancel which asks Razorpay to
// stop the subscription immediately.
import { useRouter } from "expo-router";
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
import { C } from "@/src/theme";
import { Button, EmptyState, Icon, Toast } from "@/src/ui";

type Pledge = {
  id: string;
  subscription_id?: string;
  reporter: { id: string; name: string; verified?: boolean };
  amount: number;
  status: "pending" | "verified" | "active" | "cancelled";
  created_at: string;
};

export default function Pledges() {
  const router = useRouter();
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState<Pledge | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await apiGet<Pledge[]>("/support/pledges");
      setPledges(rows);
    } catch {
      setToast({ message: "Could not load your pledges.", tone: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const cancel = async () => {
    if (!cancelling || busy) return;
    setBusy(true);
    try {
      await apiPost(`/support/pledges/${cancelling.id}/cancel`);
      setToast({ message: `Your monthly pledge to ${cancelling.reporter.name} was cancelled.`, tone: "success" });
      setCancelling(null);
      await load();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Could not cancel.";
      setToast({ message, tone: e instanceof ApiError && e.status === 503 ? "info" : "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable testID="pledges-back" onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Icon name="chevron-back" color={C.ink} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.title}>My pledges</Text>
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
          <Text style={styles.subtitle}>
            Recurring support for the reporters you back every month. Cancel anytime — your next billing cycle will be skipped.
          </Text>

          {pledges.length === 0 ? (
            <EmptyState
              title="You haven't pledged yet."
              body="Tap Support ₹7 on any reporter to start a monthly pledge."
              icon="repeat"
            />
          ) : (
            pledges.map((p) => (
              <View key={p.id} testID={`pledge-item-${p.id}`} style={styles.card}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <View style={styles.mark}>
                    <Text style={styles.markInitial}>{p.reporter.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reporterName}>
                      {p.reporter.name}{" "}
                      {p.reporter.verified ? <Icon name="checkmark-circle" color={C.blue} size={13} /> : null}
                    </Text>
                    <Text style={styles.meta}>
                      Since {new Date(p.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={styles.amountPill}>
                    <Text style={styles.amountText}>₹{p.amount}/mo</Text>
                  </View>
                </View>

                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor(p.status) }]} />
                  <Text style={[styles.statusText, { color: statusColor(p.status) }]}>{statusLabel(p.status)}</Text>
                </View>

                <Pressable
                  testID={`pledge-cancel-${p.id}`}
                  onPress={() => setCancelling(p)}
                  style={styles.cancelBtn}
                >
                  <Icon name="close-circle-outline" color={C.red} size={17} />
                  <Text style={styles.cancelBtnText}>Cancel pledge</Text>
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      )}

      <Modal visible={!!cancelling} transparent animationType="slide" onRequestClose={() => setCancelling(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.overline}>CANCEL PLEDGE</Text>
            <Text style={styles.modalTitle}>Cancel your monthly ₹7 to {cancelling?.reporter.name}?</Text>
            <Text style={styles.meta}>
              Razorpay will stop billing you immediately. Any support already sent this cycle stays with the reporter.
            </Text>
            <Button testID="pledge-cancel-confirm" onPress={cancel} tone="red" loading={busy}>
              Yes, cancel
            </Button>
            <Button onPress={() => setCancelling(null)} tone="outline">
              Keep supporting
            </Button>
          </View>
        </View>
      </Modal>

      {toast ? <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} /> : null}
    </SafeAreaView>
  );
}

function statusLabel(status: Pledge["status"]) {
  return status === "verified" || status === "active"
    ? "Active"
    : status === "pending"
      ? "Pending first charge"
      : "Cancelled";
}

function statusColor(status: Pledge["status"]) {
  return status === "verified" || status === "active"
    ? C.green
    : status === "pending"
      ? C.amber
      : C.muted;
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
  subtitle: { color: C.muted, fontSize: 13, lineHeight: 20, marginBottom: 18 },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    padding: 16,
    marginBottom: 12,
    borderRadius: 6,
  },
  mark: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.dark,
    alignItems: "center",
    justifyContent: "center",
  },
  markInitial: { color: C.surface, fontWeight: "800", fontSize: 16 },
  reporterName: { color: C.ink, fontSize: 15, fontWeight: "800" },
  meta: { color: C.muted, fontSize: 12, marginTop: 3 },
  amountPill: {
    backgroundColor: C.paper,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  amountText: { color: C.ink, fontWeight: "800", fontSize: 12 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: C.red,
    paddingVertical: 12,
    borderRadius: 6,
  },
  cancelBtnText: { color: C.red, fontWeight: "800", fontSize: 13 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(24,32,42,0.55)", justifyContent: "flex-end" },
  modal: { backgroundColor: C.surface, padding: 22, paddingBottom: 32, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  overline: { color: C.muted, fontSize: 11, letterSpacing: 1.5, fontWeight: "800" },
  modalTitle: { color: C.ink, fontSize: 20, fontWeight: "800", marginTop: 8, marginBottom: 12, lineHeight: 26 },
});
