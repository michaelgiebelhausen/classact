import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { getAiSettings } from "@/server/actions/aisettings";
import { Card, CardContent } from "@/components/ui/card";
import { AiSettingsForm } from "@/components/features/settings/AiSettingsForm";

/** BYOK — a professor's OpenRouter key + model choices (docs/byok-billing-plan.md). */

export default async function AiSettingsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const settings = await getAiSettings();

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Settings</h1>
        <p className="text-sm text-muted-foreground">
          Your courses&apos; AI runs on your own OpenRouter account — your
          credits, your models, your call.
        </p>
      </div>
      {settings ? (
        <AiSettingsForm settings={settings} />
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            AI settings are for professor accounts. (Students never need
            keys — your professor&apos;s account covers class AI.)
          </CardContent>
        </Card>
      )}
    </div>
  );
}
