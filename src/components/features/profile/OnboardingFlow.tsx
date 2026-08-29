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
  initialFirst: string;
  initialLast: string;
  initialFirstPhonetic: string;
  initialLastPhonetic: string;
  /** True only when the pronunciation was pre-filled from a roster/AI guess,
   *  not from the student's own saved value — it's what the nudge copy asks
   *  them to fix, so it must not claim to have guessed their own answer. */
  phoneticWasGuessed: boolean;
  photoUrls: Partial<Record<PhotoKind, string>>;
  icebreakerKeys: string[];
  initialAnswers: Record<string, string>;
}

export function OnboardingFlow({
  initialFirst,
  initialLast,
  initialFirstPhonetic,
  initialLastPhonetic,
  phoneticWasGuessed,
  photoUrls,
  icebreakerKeys,
  initialAnswers,
}: Props) {
  const router = useRouter();
  const fields = icebreakersByKey(icebreakerKeys);
  const [step, setStep] = useState(0);
  const [firstName, setFirstName] = useState(initialFirst);
  const [lastName, setLastName] = useState(initialLast);
  const [firstPhonetic, setFirstPhonetic] = useState(initialFirstPhonetic);
  const [lastPhonetic, setLastPhonetic] = useState(initialLastPhonetic);
  const guessedPhonetic = phoneticWasGuessed;
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [finishing, setFinishing] = useState(false);

  const steps = fields.length > 0 ? 2 : 1;

  async function finish() {
    if (firstName.trim().length < 1) {
      toast.error("Tell us your name — it's how classmates find you.");
      setStep(0);
      return;
    }
    setFinishing(true);
    const result = await completeOnboarding({
      firstName,
      lastName,
      firstNamePhonetic: firstPhonetic,
      lastNamePhonetic: lastPhonetic,
      answers,
    });
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
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="firstName">First name</Label>
                  <Input
                    id="firstName"
                    required
                    placeholder="Jordan"
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="firstPhonetic">
                    How you say it{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="firstPhonetic"
                    placeholder="JOR-dun"
                    value={firstPhonetic}
                    onChange={(e) => setFirstPhonetic(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input
                    id="lastName"
                    placeholder="Rivera"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="lastPhonetic">
                    How you say it{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="lastPhonetic"
                    placeholder="ree-VAIR-uh"
                    value={lastPhonetic}
                    onChange={(e) => setLastPhonetic(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {guessedPhonetic
                  ? "We took a best guess — fix it if it's off so classmates say your name right."
                  : "A quick pronunciation guide so classmates get your name right."}
              </p>
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
