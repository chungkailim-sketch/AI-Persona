import { requireUser } from '@/auth/guard';

/** Report mode has no application chrome, but it is not public: the session is resolved here. */
export default async function ReportLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <>{children}</>;
}
