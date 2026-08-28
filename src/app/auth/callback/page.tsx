import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { completeAuthCallback } from "@/server/actions/authcallback";
import {
  failPath,
  one,
  reasonFromProviderError,
  safeNext,
} from "@/lib/authcallback";

/**
 * The last step of an email sign-in link — and deliberately not automatic.
 *
 * This used to be a route handler that spent the one-time token the moment
 * anything fetched the URL. University mail security fetches every link in
 * every email before its recipient does, so the token was routinely gone by
 * the time the student tapped it, and they were told their link had expired.
 * Production logs for one class showed a HEAD landing here about a second
 * ahead of nearly every student's click, plus links spent by a scanner for
 * students who never clicked at all.
 *
 * Answering HEAD separately fixed the common case. This fixes the category:
 * rendering this page reads the token and verifies nothing. Signing in happens
 * on a POST, from a button someone presses. Scanners follow links; they do not
 * submit forms.
 *
 * The cost is one tap, and it buys a page that says what is about to happen —
 * which is worth something on its own, given how this week went.
 */

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const next = safeNext(one(params.next));
  const tokenHash = one(params.token_hash) ?? "";
  const code = one(params.code) ?? "";
  const type = one(params.type) ?? "";

  // Supabase reports its own failures by redirecting here with error params
  // rather than a token. Surfacing them beats showing a blank sign-in form.
  const providerError = one(params.error) ?? one(params.error_code);
  if (providerError && !tokenHash && !code) {
    redirect(failPath(reasonFromProviderError(providerError), next));
  }

  if (!tokenHash && !code) redirect(failPath("no_token", next));

  return (
    <main className="mx-auto flex min-h-svh max-w-md items-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>One more tap</CardTitle>
          <CardDescription>
            Your link is good. Press the button and we&apos;ll sign you in.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form action={completeAuthCallback}>
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="code" value={code} />
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="next" value={next} />
            <Button type="submit" className="w-full" size="lg">
              Sign me in
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            We wait for that press on purpose. Campus mail systems open links
            automatically to scan them, and a sign-in link only works once — so
            if opening it were enough to spend it, the scan would use yours up
            before you ever saw this page.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
