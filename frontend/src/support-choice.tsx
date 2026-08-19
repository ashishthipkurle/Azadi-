// Support-choice bottom sheet — lets the reader pick between a one-time ₹7 tip
// and a recurring monthly ₹7 pledge before Razorpay Checkout opens.
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { C } from "@/src/theme";
import { Button, Icon } from "@/src/ui";

export type SupportInterval = "once" | "monthly";

export function SupportChoiceSheet({
  visible,
  reporterName,
  onDismiss,
  onChoose,
}: {
  visible: boolean;
  reporterName: string;
  onDismiss: () => void;
  onChoose: (interval: SupportInterval) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.overline}>SUPPORT · ₹7</Text>
          <Text style={styles.title}>Back {reporterName}.</Text>
          <Text style={styles.body}>
            Reporters keep 100% of your support after Razorpay's platform fee.
          </Text>

          <Pressable testID="support-once-option" onPress={() => onChoose("once")} style={styles.option}>
            <View style={styles.optionIcon}>
              <Icon name="heart-outline" color={C.red} size={20} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.optionTitle}>One-time ₹7</Text>
              <Text style={styles.optionBody}>A quick tip to say thanks for this dispatch.</Text>
            </View>
            <Icon name="chevron-forward" color={C.muted} />
          </Pressable>

          <Pressable testID="support-monthly-option" onPress={() => onChoose("monthly")} style={[styles.option, styles.optionRed]}>
            <View style={[styles.optionIcon, { backgroundColor: "#F5E5E2" }]}>
              <Icon name="repeat" color={C.red} size={20} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.optionTitle, { color: C.surface }]}>Monthly ₹7 pledge</Text>
              <Text style={[styles.optionBody, { color: "#F5C7C2" }]}>
                Auto-renews every month · cancel anytime.
              </Text>
            </View>
            <Icon name="chevron-forward" color={C.surface} />
          </Pressable>

          <Button onPress={onDismiss} tone="outline">
            Cancel
          </Button>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(24,32,42,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: C.surface,
    padding: 22,
    paddingBottom: 32,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    gap: 8,
  },
  overline: { color: C.muted, fontSize: 11, letterSpacing: 1.5, fontWeight: "800" },
  title: { color: C.ink, fontSize: 24, fontWeight: "800", letterSpacing: -0.5, marginTop: 4 },
  body: { color: C.muted, fontSize: 13, lineHeight: 20, marginBottom: 14 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: C.line,
    padding: 14,
    borderRadius: 8,
    backgroundColor: C.paper,
    marginBottom: 10,
  },
  optionRed: { backgroundColor: C.red, borderColor: C.red },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  optionTitle: { color: C.ink, fontSize: 15, fontWeight: "800" },
  optionBody: { color: C.muted, fontSize: 12, marginTop: 3 },
});
