// Razorpay checkout modal.
// We render Razorpay Standard Checkout inside a WebView so it works everywhere
// (Expo Go, dev-build, web preview) without requiring the native SDK.
// Flow:
//   1. Parent calls POST /api/support -> { order_id, key_id, amount, currency }.
//   2. We open a WebView with an HTML shell that loads checkout.js and calls
//      Razorpay(...).open() with the order and key.
//   3. Razorpay posts back success/failure via window.ReactNativeWebView.postMessage.
//   4. On success we call POST /api/support/verify with the returned signature.
//
// If Razorpay keys are missing on the backend, the initial /api/support call
// returns HTTP 503 with a friendly message which the parent surfaces as a toast.
import { useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { apiPost, ApiError } from "@/src/api";
import { C } from "@/src/theme";
import { Icon } from "@/src/ui";

export type CheckoutOrder = {
  order_id: string;
  key_id: string;
  amount: number;
  currency: string;
};

type Props = {
  visible: boolean;
  order: CheckoutOrder | null;
  reporterName: string;
  userName?: string;
  userEmail?: string;
  onDismiss: () => void;
  onResult: (result: { ok: boolean; message: string }) => void;
};

function buildHtml(order: CheckoutOrder, name: string, email: string, reporter: string) {
  // Inline HTML shell that boots Razorpay Standard Checkout.
  // Uses window.ReactNativeWebView.postMessage to talk back to the app.
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  html,body{margin:0;padding:0;height:100%;background:#F4F0E8;font-family:-apple-system,system-ui,Roboto,sans-serif;color:#18202A}
  .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center}
  h1{font-size:22px;margin:8px 0 4px}
  p{color:#59616A;font-size:14px;margin:0 0 24px}
  button{background:#B42318;color:#fff;border:0;font-weight:800;font-size:15px;padding:14px 24px;border-radius:6px;letter-spacing:0.3px}
</style></head><body>
<div class="wrap">
  <h1>Support ${reporter}</h1>
  <p>Complete your ₹7 payment securely with Razorpay.</p>
  <button id="pay">Pay ₹${(order.amount / 100).toFixed(0)}</button>
</div>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  function tell(payload){
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }
  var opts = {
    key: ${JSON.stringify(order.key_id)},
    amount: ${JSON.stringify(order.amount)},
    currency: ${JSON.stringify(order.currency)},
    name: "FreePress",
    description: "Support " + ${JSON.stringify(reporter)},
    order_id: ${JSON.stringify(order.order_id)},
    prefill: { name: ${JSON.stringify(name)}, email: ${JSON.stringify(email)} },
    theme: { color: "#18202A" },
    handler: function(response){ tell({ type: "success", payload: response }); },
    modal: { ondismiss: function(){ tell({ type: "dismiss" }); } }
  };
  var rzp = new Razorpay(opts);
  rzp.on('payment.failed', function(response){ tell({ type: "failed", payload: response.error }); });
  document.getElementById('pay').addEventListener('click', function(){ rzp.open(); });
  // Auto-open on load
  setTimeout(function(){ rzp.open(); }, 350);
</script>
</body></html>`;
}

export function RazorpayCheckout({ visible, order, reporterName, userName, userEmail, onDismiss, onResult }: Props) {
  const html = useMemo(
    () => (order ? buildHtml(order, userName || "", userEmail || "", reporterName) : ""),
    [order, userName, userEmail, reporterName],
  );

  const handleMessage = async (event: WebViewMessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === "dismiss") {
      onDismiss();
      return;
    }
    if (msg.type === "failed") {
      onResult({ ok: false, message: msg.payload?.description || "Payment was declined." });
      return;
    }
    if (msg.type === "success" && msg.payload) {
      try {
        await apiPost("/support/verify", {
          razorpay_order_id: msg.payload.razorpay_order_id,
          razorpay_payment_id: msg.payload.razorpay_payment_id,
          razorpay_signature: msg.payload.razorpay_signature,
        });
        onResult({ ok: true, message: `Thanks! ₹7 is on the way to ${reporterName}.` });
      } catch (e) {
        const message = e instanceof ApiError ? e.message : "Payment could not be verified.";
        onResult({ ok: false, message });
      }
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onDismiss} presentationStyle="pageSheet">
      <View style={styles.container}>
        <View style={styles.bar}>
          <Text style={styles.title}>Support · ₹7</Text>
          <Pressable testID="razorpay-close" onPress={onDismiss} hitSlop={12}>
            <Icon name="close" size={22} color={C.ink} />
          </Pressable>
        </View>
        {order ? (
          <WebView
            testID="razorpay-webview"
            originWhitelist={["*"]}
            source={{ html, baseUrl: "https://checkout.razorpay.com" }}
            onMessage={handleMessage}
            javaScriptEnabled
            domStorageEnabled
            style={{ flex: 1, backgroundColor: C.paper }}
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    backgroundColor: C.surface,
  },
  title: { color: C.ink, fontSize: 18, fontWeight: "800" },
});

