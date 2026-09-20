export const metadata = { title: "Access required" };

export default function LockedPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[520px] flex-col justify-center px-5">
      <h1 className="serif text-[26px] leading-tight text-navy">This link requires an access key.</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
        Open the address you were sent — it carries the key — and this browser will be admitted for thirty days.
      </p>
    </main>
  );
}
