"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Armchair,
  BarChart3,
  Briefcase,
  LayoutDashboard,
  Megaphone,
  MonitorPlay,
  Settings,
  Sparkles,
  Users,
  Vote,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/types/db";

interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Route segment under /course/[id]/ */
  seg: string;
  status: "live" | "soon";
}

// Chronological student-journey order (Mike's naming).
const COURSE_NAV: NavItem[] = [
  { label: "Check In", icon: Armchair, seg: "checkin", status: "live" },
  { label: "Learn Names", icon: Sparkles, seg: "games", status: "live" },
  { label: "Follow Along", icon: MonitorPlay, seg: "follow", status: "soon" },
  { label: "Participate", icon: Vote, seg: "participate", status: "soon" },
  { label: "Shout-outs", icon: Megaphone, seg: "shoutouts", status: "soon" },
  { label: "Projects", icon: Users, seg: "projects", status: "soon" },
  { label: "My Metrics", icon: BarChart3, seg: "metrics", status: "live" },
  { label: "Job Offers", icon: Briefcase, seg: "jobs", status: "soon" },
];

function RailLink({
  label,
  icon: Icon,
  href,
  active,
  disabled,
}: {
  label: string;
  icon: LucideIcon;
  href?: string;
  active?: boolean;
  disabled?: boolean;
}) {
  const base =
    "group relative flex w-[62px] flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 text-[10px] font-semibold tracking-tight transition-colors";
  const inner = (
    <>
      {active && (
        <span className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-[var(--sidebar-primary)]" />
      )}
      <Icon className="size-5" strokeWidth={1.75} />
      <span className="leading-none">{label}</span>
    </>
  );

  if (disabled || !href) {
    return (
      <div
        title={`${label} — coming soon`}
        className={`${base} cursor-default text-[#5b647d] opacity-55`}
      >
        {inner}
      </div>
    );
  }
  return (
    <Link
      href={href}
      className={`${base} ${
        active
          ? "bg-[var(--sidebar-accent)] text-white"
          : "text-[#8b93a9] hover:bg-[var(--sidebar-accent)] hover:text-[#e7e9f0]"
      }`}
    >
      {inner}
    </Link>
  );
}

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname() ?? "";
  const match = pathname.match(/\/course\/([^/]+)/);
  const courseId = match?.[1];
  const homeActive = pathname === "/dashboard" || pathname === "/";

  return (
    <nav className="sticky top-0 z-20 flex h-screen w-[84px] shrink-0 flex-col items-center gap-1.5 bg-[var(--sidebar)] py-5">
      <Link
        href="/dashboard"
        className="mb-3 grid size-11 place-items-center rounded-[13px] bg-gradient-to-br from-[var(--flame)] to-[#c33d1c] font-[family-name:var(--font-heading)] text-xl font-semibold text-white shadow-[0_6px_16px_-4px_rgba(224,85,47,0.6)]"
        aria-label="ClassAct home"
      >
        C
      </Link>

      <RailLink
        label="Home"
        icon={LayoutDashboard}
        href="/dashboard"
        active={homeActive}
      />

      <div className="my-1.5 h-px w-8 bg-white/10" />

      {COURSE_NAV.map((item) => {
        const href =
          courseId && item.status === "live"
            ? `/course/${courseId}/${item.seg}`
            : undefined;
        const active = Boolean(
          courseId && pathname.startsWith(`/course/${courseId}/${item.seg}`)
        );
        return (
          <RailLink
            key={item.label}
            label={item.label}
            icon={item.icon}
            href={href}
            active={active}
            disabled={!href}
          />
        );
      })}

      <div className="flex-1" />
      <div className="my-1.5 h-px w-8 bg-white/10" />
      <RailLink
        label={role === "professor" ? "Setup" : "Profile"}
        icon={Settings}
        href={role === "professor" ? "/dashboard" : "/profile"}
      />
    </nav>
  );
}
