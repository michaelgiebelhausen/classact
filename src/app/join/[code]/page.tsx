import { redirect } from "next/navigation";
import { JoinForm } from "@/components/features/JoinForm";
import { createClient } from "@/lib/supabase/server";

/**
 * The invite link's landing page.
 *
 * A student who is already signed in used to be shown the sign-up form anyway,
 * with no way past it: submitting their own address hit "an account with this
 * email already exists", and the dashboard showed no classes because they had
 * never actually joined one. That is the dead end a student reported —
 * "I cannot put the code in either due to already being logged in."
 *
 * With a session in hand there is nothing to ask for, so hand the code
 * straight to /auth/join, which is the same place the form would have sent
 * them after authenticating.
 */
export default async function JoinWithCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normalized = decodeURIComponent(code).toUpperCase();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(`/auth/join?code=${encodeURIComponent(normalized)}`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <JoinForm initialCode={normalized} />
    </div>
  );
}
