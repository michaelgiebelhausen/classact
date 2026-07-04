import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const valueProps = [
  {
    title: "Fraud-proof attendance",
    body: "Students verify each other in the room. No clickers to hand off, no logging in from bed.",
  },
  {
    title: "A room that actually knows itself",
    body: "Seat check-in makes students meet their neighbors; name games mean everyone learns names by week three.",
  },
  {
    title: "You do nothing new",
    body: "Set up your room once — about five minutes. After that it runs itself.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="text-lg font-semibold tracking-tight">ClassAct</span>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link href="/join">I have a join code</Link>
          </Button>
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center gap-12 px-6 py-20 text-center">
        <div className="flex flex-col items-center gap-4">
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Take attendance in zero class time — and no, they can&apos;t cheat
            it.
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            Students check in by tapping their seat and confirming the people
            around them. Attendance gets verified, and your class stops being a
            room full of strangers.
          </p>
          <div className="mt-2 flex gap-3">
            <Button asChild size="lg">
              <Link href="/login">Set up your class</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/join">Join with a code</Link>
            </Button>
          </div>
        </div>

        <div className="grid w-full gap-4 sm:grid-cols-3">
          {valueProps.map((vp) => (
            <Card key={vp.title} className="text-left">
              <CardHeader>
                <CardTitle className="text-base">{vp.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {vp.body}
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-sm text-muted-foreground">
          Works with your Canvas or Blackboard roster. Students own their data
          — nothing leaves the class unless they say so.
        </p>
      </main>

      <footer className="border-t px-6 py-4 text-center text-xs text-muted-foreground">
        ClassAct · classact.college
      </footer>
    </div>
  );
}
