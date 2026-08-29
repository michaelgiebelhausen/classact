import { JoinForm } from "@/components/features/JoinForm";
import { createClient } from "@/lib/supabase/server";

/**
 * "Join a class" for someone typing a code by hand. The dashboard, landing
 * page, and login page all link here — which means most visitors are already
 * signed in. They get a code-only form that joins directly; asking them for
 * an email and password again just walks them into "an account with this
 * email already exists". Only a visitor with no session sees the sign-up form.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <JoinForm
        badCode={error === "badcode"}
        authedEmail={user?.email ?? undefined}
      />
    </div>
  );
}
