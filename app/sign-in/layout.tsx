import { LanguageSwitcher } from '@/ui/i18n/LanguageSwitcher';

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <div className="flex justify-end px-4 pt-4">
        <LanguageSwitcher />
      </div>
      <main id="main">{children}</main>
    </div>
  );
}
