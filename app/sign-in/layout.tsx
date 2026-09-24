export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <main id="main">{children}</main>
    </div>
  );
}
