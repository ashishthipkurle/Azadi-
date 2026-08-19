import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/src/auth";

export default function ReporterLayout() {
  const { ready, user } = useAuth();
  if (!ready) return null;
  if (!user) return <Redirect href="/" />;
  if (user.role !== "reporter" && user.role !== "admin") {
    return <Redirect href="/(reader)/feed" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
