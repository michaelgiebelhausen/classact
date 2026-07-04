import { JoinForm } from "@/components/features/JoinForm";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <JoinForm badCode={error === "badcode"} />
    </div>
  );
}
