import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { getSignedPhotoUrls } from "@/lib/storage";
import { PhotoUploader } from "@/components/features/profile/PhotoUploader";
import { DeleteDataButton } from "@/components/features/profile/DeleteDataButton";
import type { PhotoKind } from "@/types/db";

export default async function ProfilePage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: photos } = await supabase
    .from("profile_photos")
    .select("kind, storage_path")
    .eq("profile_id", profile.id);

  const urlMap = await getSignedPhotoUrls(
    supabase,
    (photos ?? []).map((p) => p.storage_path)
  );
  const photoUrls: Partial<Record<PhotoKind, string>> = {};
  for (const p of photos ?? []) {
    const url = urlMap[p.storage_path];
    if (url) photoUrls[p.kind as PhotoKind] = url;
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
        <p className="text-sm text-muted-foreground">
          {profile.full_name ?? "No name set"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>My photos</CardTitle>
          <CardDescription>
            These are what classmates see in the name games.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <PhotoUploader kind="candid" initialUrl={photoUrls.candid ?? null} />
          <PhotoUploader
            kind="professional"
            initialUrl={photoUrls.professional ?? null}
          />
          <PhotoUploader
            kind="adventure"
            initialUrl={photoUrls.adventure ?? null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your data, your call</CardTitle>
          <CardDescription>
            You own your data. Nothing leaves this class unless you say so —
            and you can delete your photos and answers any time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteDataButton />
        </CardContent>
      </Card>
    </div>
  );
}
