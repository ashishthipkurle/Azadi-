import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/src/auth";

export default function AdminLayout() {
  const { ready, user } = useAuth();
  if (!ready) return null;
  if (!user) return <Redirect href="/" />;
  if (user.role !== "admin") {
    const dest = user.role === "reporter" ? "/(reporter)/studio" : "/(reader)/feed";
    return <Redirect href={dest} />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
