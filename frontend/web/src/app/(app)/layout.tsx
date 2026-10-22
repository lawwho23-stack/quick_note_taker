import { AppShell } from "@/components/app-shell";

/** Signed-in pages share the sidebar shell and its session check. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
