"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PhotoUploader } from "@/components/features/profile/PhotoUploader";
import { completeOnboarding } from "@/server/actions/enrollment";
import { capture } from "@/lib/analytics";
import { icebreakersByKey } from "@/lib/icebreakers";
import type { PhotoKind } from "@/types/db";

interface Props {
  initialName: string;
  photoUrls: Partial<Record<PhotoKind, string>>;
  icebreakerKeys: string[];
  initialAnswers: Record<string, string>;
}

export function OnboardingFlow({
  initialName,
  photoUrls,
  icebreakerKeys,
  initialAnswers,
}: Props) {
  const router = useRouter();
  const fields = icebreakersByKey(icebreakerKeys);
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState(initialName);
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [finishing, setFinishing] = useState(false);

  const steps = fields.length > 0 ? 2 : 1;

  async function finish() {
    if (fullName.trim().length < 2) {
      toast.error("Tell us your name — it's how classmates find you.");
      setStep(0);
      return;
    }
    setFinishing(true);
    const result = await completeOnboarding({ fullName, answers });
    if (result.ok) {
      capture("onboarding_completed");
      toast.success("You're set. See you in class.");
      router.push("/dashboard");
      router.refresh();
    } else {
      setFinishing(false);
      toast.error(result.error);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4">
      <Progress value={((step + 1) / steps) * 100} className="h-1" />

      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Add your name and photos</CardTitle>
            <CardDescription>
              Photos help everyone put a name to your face. Takes two minutes.
              You can skip some and add them later.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="grid gap-2">
              <Label htmlFor="fullName">Your name</Label>
              <Input
                id="fullName"
                required
                placeholder="Jordan Rivera"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <PhotoUploader kind="candid" initialUrl={photoUrls.candid ?? null} />
              <PhotoUploader
                kind="professional"
                initialUrl={photoUrls.professional ?? null}
              />
              <PhotoUploader
                kind="adventure"
                initialUrl={photoUrls.adventure ?? null}
              />
            </div>
            <div className="flex justify-end">
              {steps > 1 ? (
                <Button onClick={() => setStep(1)}>Next</Button>
              ) : (
                <Button onClick={finish} disabled={finishing}>
                  {finishing ? "Finishing…" : "Finish"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>A few icebreakers</CardTitle>
            <CardDescription>
              Your professor picked these. Answers show up in the name games.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {fields.map((f) => (
              <div key={f.key} className="grid gap-2">
                <Label htmlFor={f.key}>{f.prompt}</Label>
                {f.multiline ? (
                  <Textarea
                    id={f.key}
                    placeholder={f.placeholder}
                    value={answers[f.key] ?? ""}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [f.key]: e.target.value }))
                    }
                  />
                ) : (
                  <Input
                    id={f.key}
                    placeholder={f.placeholder}
                    value={answers[f.key] ?? ""}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [f.key]: e.target.value }))
                    }
                  />
                )}
              </div>
            ))}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button onClick={finish} disabled={finishing}>
                {finishing ? "Finishing…" : "Finish"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
