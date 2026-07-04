import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        That page isn&apos;t here.
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The link may be old, or the class may have been removed.
      </p>
      <Button asChild>
        <Link href="/dashboard">Back to my classes</Link>
      </Button>
    </div>
  );
}
