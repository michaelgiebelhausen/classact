"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { saveUserDoc, deleteUserDoc } from "@/server/actions/profile";
import type { UserDocView } from "@/server/actions/profile";
import { validateUserDoc, MAX_USER_DOC_BYTES } from "@/lib/usermd";

/**
 * Upload a Markdown file to your own profile, or replace the one that's there.
 *
 * No editor, by design. The file lives on their machine and they replace it by
 * uploading again — so the copy they wrote stays the original rather than
 * becoming a textarea's idea of it.
 *
 * The file is read in the browser and sent as text, which is what makes the
 * whole thing a couple of server actions instead of a storage bucket with
 * signed URLs. The size cap is what keeps that reasonable.
 */
export function UserDocUpload({ current }: { current: UserDocView | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const content = await file.text();
      // Checked here so they hear about a bad file immediately; the server
      // checks again, because that is where the rule actually lives.
      const verdict = validateUserDoc({ filename: file.name, content });
      if (!verdict.ok) {
        toast.error(verdict.error, { duration: 8000 });
        return;
      }
      const result = await saveUserDoc({ filename: file.name, content });
      if (!result.ok) {
        toast.error(result.error, { duration: 8000 });
        return;
      }
      toast.success(
        current ? `Replaced with ${file.name}.` : `Saved ${file.name}.`
      );
      router.refresh();
    } catch {
      toast.error("Couldn't read that file.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    const result = await deleteUserDoc();
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Removed.");
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      {current ? (
        <div className="grid gap-1 rounded-md border px-3 py-2">
          <span className="font-mono text-sm font-medium">
            {current.filename}
          </span>
          <span className="text-xs text-muted-foreground">
            {current.bytes < 1024
              ? `${current.bytes} bytes`
              : `${(current.bytes / 1024).toFixed(1)} KB`}{" "}
            · uploaded{" "}
            {new Date(current.updatedAt).toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
            })}
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing uploaded yet.
        </p>
      )}

      <input
        ref={input}
        type="file"
        accept=".md,text/markdown"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={current ? "outline" : "default"}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy
            ? "Working…"
            : current
              ? "Replace it"
              : "Upload a .md file"}
        </Button>

        {current &&
          (confirming ? (
            <>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={remove}
              >
                Yes, remove it
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              Remove
            </Button>
          ))}

        <span className="text-xs text-muted-foreground">
          Markdown only, up to {MAX_USER_DOC_BYTES / 1024} KB.
        </span>
      </div>
    </div>
  );
}
