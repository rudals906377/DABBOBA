import { AdminShell } from "../../components/admin-shell";
import { requireAdmin } from "../../lib/auth";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await requireAdmin();
  return <AdminShell actor={actor}>{children}</AdminShell>;
}
