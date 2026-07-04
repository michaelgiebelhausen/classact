import { JoinForm } from "@/components/features/JoinForm";

export default async function JoinWithCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <JoinForm initialCode={decodeURIComponent(code).toUpperCase()} />
    </div>
  );
}
