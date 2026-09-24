import { redirect } from 'next/navigation';
import { SignInForm } from './SignInForm';
import { currentSession } from '@/auth/session';
import { safeInternalPath } from '@/lib/safeRedirect';
import { loadEnv } from '@/lib/env';

export const metadata = { title: 'Sign in · Persona Intelligence' };
export const dynamic = 'force-dynamic';

export default async function SignInPage(props: PageProps<'/sign-in'>) {
  if (await currentSession()) redirect('/dashboard');

  const params = await props.searchParams;
  const raw = params.next;
  const next = safeInternalPath(Array.isArray(raw) ? raw[0] : raw);

  let devAdapter = false;
  try {
    devAdapter = loadEnv().EMAIL_PROVIDER === 'dev';
  } catch {
    devAdapter = false;
  }

  return (
    <>
      <SignInForm next={next} />
      {devAdapter && (
        <p className="mx-auto max-w-sm px-6 pb-12 text-xs text-warn">
          Development email adapter is active: the sign-in code is written to the server log
          instead of being emailed. This configuration is refused in production.
        </p>
      )}
    </>
  );
}
