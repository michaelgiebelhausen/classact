export async function contributionCommand(_course: string, _project: string, _team: string, action: string, data: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent("contribution-preview-command", { detail: { action, data } }));
  return { ok: true as const };
}
