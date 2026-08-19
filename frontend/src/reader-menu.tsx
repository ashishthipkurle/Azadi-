// Reader header menu — a bottom sheet from the avatar with quick nav.
import { useRouter } from "expo-router";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/src/auth";
import { C } from "@/src/theme";
import { Icon } from "@/src/ui";

export function ReaderMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const go = (path: string) => {
    onClose();
    router.push(path as any);
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.identity}>
            <View style={styles.avatar}>
              <Text style={styles.avatarInitial}>{user?.name?.[0] || "?"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{user?.name}</Text>
              <Text style={styles.email}>{user?.email}</Text>
            </View>
          </View>

          <Row icon="bookmark-outline" title="Saved dispatches" body="Your private reading list, cached for offline" testID="menu-saved" onPress={() => go("/(reader)/saved")} />
          <Row icon="repeat" title="My pledges" body="Manage or cancel your monthly ₹7 support" testID="menu-pledges" onPress={() => go("/(reader)/pledges")} />
          <Row icon="log-out-outline" title="Sign out" body="Leave your session on this device" testID="menu-logout" onPress={async () => { onClose(); await logout(); }} tone="red" />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({
  icon,
  title,
  body,
  onPress,
  testID,
  tone,
}: {
  icon: any;
  title: string;
  body: string;
  onPress: () => void;
  testID: string;
  tone?: string;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <View style={styles.rowIcon}>
        <Icon name={icon} color={tone || C.ink} size={19} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, tone ? { color: tone } : null]}>{title}</Text>
        <Text style={styles.rowBody}>{body}</Text>
      </View>
      <Icon name="chevron-forward" color={C.muted} size={17} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(24,32,42,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: C.surface,
    padding: 20,
    paddingBottom: 34,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
    marginBottom: 16,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.dark,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: { color: C.surface, fontSize: 20, fontWeight: "800" },
  name: { color: C.ink, fontSize: 16, fontWeight: "800" },
  email: { color: C.muted, fontSize: 12, marginTop: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingVertical: 14,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { color: C.ink, fontWeight: "800", fontSize: 14 },
  rowBody: { color: C.muted, fontSize: 12, marginTop: 3 },
});
