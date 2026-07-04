import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { AppNav } from "@/components/features/AppNav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  // Onboarding gate: students finish onboarding before using the app.
  // /onboarding lives outside this layout group, so no redirect loop.
  if (profile.role === "student" && !profile.onboarding_complete) {
    redirect("/onboarding");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppNav role={profile.role} name={profile.full_name} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
