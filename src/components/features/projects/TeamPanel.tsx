"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Crown, FileSignature, LogOut, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createTeam,
  joinTeam,
  leaveTeam,
  signContract,
  updateTeamContract,
} from "@/server/actions/teams";

export interface TeamMemberInfo {
  enrollmentId: string;
  name: string;
  role: "lead" | "member";
  signed: boolean;
}

export interface TeamInfo {
  id: string;
  name: string;
  contractText: string;
  members: TeamMemberInfo[];
}

interface Props {
  courseId: string;
  projectId: string;
  targetTeamSize: number | null;
  myEnrollmentId: string;
  teams: TeamInfo[];
}

/**
 * Student team area under an open project: join or create a team, see who's
 * on which one, and (once on a team) read/edit/sign the team contract.
 * Editing the contract clears signatures so everyone re-signs.
 */
export function TeamPanel({
  courseId,
  projectId,
  targetTeamSize,
  myEnrollmentId,
  teams,
}: Props) {
  const router = useRouter();
  const [newTeamName, setNewTeamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [editingContract, setEditingContract] = useState(false);
  const [contractDraft, setContractDraft] = useState("");

  const myTeam =
    teams.find((t) =>
      t.members.some((m) => m.enrollmentId === myEnrollmentId)
    ) ?? null;
  const me = myTeam?.members.find((m) => m.enrollmentId === myEnrollmentId);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    const name = newTeamName.trim();
    if (name.length < 2) {
      toast.error("Give the team a name.");
      return;
    }
    const ok = await run(() => createTeam(courseId, projectId, name));
    if (ok) {
      setNewTeamName("");
      toast.success(
        `"${name}" is live — your board has the starting task list. First up: the team contract.`
      );
    }
  }

  async function handleSign() {
    const ok = await run(() => signContract(courseId, myTeam!.id));
    if (ok) {
      toast.success("Contract signed.");
      setContractOpen(false);
    }
  }

  async function handleSaveContract() {
    const ok = await run(() =>
      updateTeamContract(courseId, myTeam!.id, contractDraft)
    );
    if (ok) {
      toast.success("Contract updated — everyone re-signs the new version.");
      setEditingContract(false);
    }
  }

  // ---------- On a team ----------
  if (myTeam && me) {
    return (
      <div className="rounded-lg border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Users className="size-4 text-muted-foreground" />
            {myTeam.name}
            <span className="text-xs font-normal text-muted-foreground">
              {myTeam.members.length}
              {targetTeamSize ? ` of ~${targetTeamSize}` : ""} members
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={me.signed ? "outline" : "default"}
              onClick={() => {
                setContractDraft(myTeam.contractText);
                setEditingContract(false);
                setContractOpen(true);
              }}
            >
              <FileSignature className="mr-1 size-4" />
              {me.signed ? "View contract" : "Read & sign contract"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (
                  window.confirm(
                    "Leave this team? Your unfinished tasks go back to Unassigned."
                  )
                ) {
                  void run(() => leaveTeam(courseId, myTeam.id));
                }
              }}
              disabled={busy}
              aria-label="Leave team"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
        <ul className="mt-2 grid gap-1">
          {myTeam.members.map((m) => (
            <li
              key={m.enrollmentId}
              className="flex items-center gap-2 text-sm"
            >
              {m.role === "lead" && (
                <Crown className="size-3.5 text-amber-500" />
              )}
              <span>{m.name}</span>
              {m.signed ? (
                <span className="flex items-center gap-0.5 text-xs text-green-700">
                  <Check className="size-3" /> signed
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  hasn&apos;t signed yet
                </span>
              )}
            </li>
          ))}
        </ul>

        <Dialog open={contractOpen} onOpenChange={setContractOpen}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Team contract — {myTeam.name}</DialogTitle>
              <DialogDescription>
                {editingContract
                  ? "Editing the contract clears all signatures — the whole team re-signs the new version."
                  : "What this team agrees to. Signing checks off your contract card."}
              </DialogDescription>
            </DialogHeader>
            {editingContract ? (
              <textarea
                value={contractDraft}
                onChange={(e) => setContractDraft(e.target.value)}
                className="min-h-64 w-full resize-y rounded-lg border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-sans text-xs">
                {myTeam.contractText}
              </pre>
            )}
            <DialogFooter className="flex-wrap">
              {editingContract ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setEditingContract(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void handleSaveContract()}
                    disabled={busy}
                  >
                    {busy ? "Saving…" : "Save contract"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setEditingContract(true)}
                  >
                    Edit
                  </Button>
                  {!me.signed && (
                    <Button onClick={() => void handleSign()} disabled={busy}>
                      {busy ? "Signing…" : "Sign the contract"}
                    </Button>
                  )}
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ---------- Not on a team yet ----------
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3">
      <p className="text-sm font-medium">
        Team up
        {targetTeamSize && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            teams of ~{targetTeamSize}
          </span>
        )}
      </p>
      {teams.length > 0 && (
        <ul className="mt-2 grid gap-1.5">
          {teams.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm">{t.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {t.members.length === 0
                    ? "empty"
                    : t.members.map((m) => m.name).join(", ")}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void run(() => joinTeam(courseId, t.id))}
                disabled={busy}
              >
                Join
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          placeholder="New team name"
          value={newTeamName}
          onChange={(e) => setNewTeamName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleCreate();
          }}
          className="max-w-56"
        />
        <Button
          size="sm"
          onClick={() => void handleCreate()}
          disabled={busy || newTeamName.trim().length < 2}
        >
          <Plus className="mr-1 size-4" /> Create team
        </Button>
      </div>
    </div>
  );
}
