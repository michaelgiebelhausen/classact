"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestEmailChange } from "@/server/actions/account";

/**
 * The two emails on an account: the read-only one imported from the LMS
 * (Canvas roster), and the editable one used to sign in. Changing the sign-in
 * email is a two-step confirmation, so this shows an inline "check your inbox"
 * state rather than pretending the change is instant.
 */
export function EmailForm({
  lmsEmail,
  accountEmail,
}: {
  lmsEmail: string | null;
  accountEmail: string;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [alsoOld, setAlsoOld] = useState(false);

  async function send() {
    setSending(true);
    const result = await requestEmailChange({ newEmail: value });
    setSending(false);
    if (result.ok && result.data) {
      setSentTo(result.data.newEmail);
      setAlsoOld(result.data.alsoEmailedCurrent);
      setValue("");
    } else if (!result.ok) {
      toast.error(result.error);
    }
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Label>Email imported from your school (Canvas)</Label>
        <Input value={lmsEmail ?? ""} readOnly disabled placeholder="Not synced from an LMS yet" />
        <p className="text-xs text-muted-foreground">
          {lmsEmail
            ? "This is the address your professor's roster has for you. It can't be edited here — it comes from Canvas."
            : "You'll see your Canvas address here once a class you're in is synced from Canvas."}
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="accountEmail">Email for your ClassAct account</Label>
        <Input id="accountEmail" value={accountEmail} readOnly disabled />
        <p className="text-xs text-muted-foreground">
          This is the address you sign in with.
        </p>
      </div>

      {sentTo ? (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p>
            Check <span className="font-medium">{sentTo}</span> and open the link
            to confirm. Your sign-in email stays the same until you do.
          </p>
          {alsoOld && (
            <p className="mt-2 text-muted-foreground">
              We also emailed your current address to approve the change — open
              both links to finish.
            </p>
          )}
          <button
            type="button"
            className="mt-2 underline underline-offset-4"
            onClick={() => setSentTo(null)}
          >
            Use a different address
          </button>
        </div>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor="newEmail">Change your sign-in email</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="newEmail"
              type="email"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="you@newaddress.edu"
              autoComplete="email"
              className="max-w-xs"
            />
            <Button onClick={send} disabled={sending || !value.trim()} variant="outline">
              {sending ? "Sending…" : "Send confirmation"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            We&apos;ll email a link to confirm the new address. Heads up: rejoining
            a class by code and Canvas syncs still use the address your professor
            has on their roster, so keep your school email if you can.
          </p>
        </div>
      )}
    </div>
  );
}
