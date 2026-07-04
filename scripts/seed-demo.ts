/**
 * Seed a demo classroom for local/pilot testing.
 *
 * Usage (requires .env.local with NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY):
 *   npx tsx --env-file=.env.local scripts/seed-demo.ts <professor-email>
 *
 * Creates: a professor account (magic-link user), one course ("Demo Course"),
 * a 5x8 room (40 seats), and a 30-student roster of synthetic students.
 * Then opens today's session so check-in can be exercised immediately.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FIRST = ["Avery", "Jordan", "Riley", "Casey", "Quinn", "Morgan", "Reese", "Skyler", "Emerson", "Rowan"];
const LAST = ["Walker", "Bennett", "Hayes", "Coleman", "Brooks", "Sanders", "Price", "Bishop", "Wells", "Grant"];

function rowLetter(n: number): string {
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

async function main() {
  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const professorEmail = process.argv[2];
  if (!professorEmail) {
    console.error("Usage: npx tsx --env-file=.env.local scripts/seed-demo.ts <professor-email>");
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  // 1. Professor auth user + profile.
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email: professorEmail,
    email_confirm: true,
  });
  let professorId = created?.user?.id;
  if (userErr) {
    // Probably exists — look it up.
    const { data: list } = await admin.auth.admin.listUsers();
    professorId = list?.users.find(
      (u) => u.email?.toLowerCase() === professorEmail.toLowerCase()
    )?.id;
  }
  if (!professorId) {
    console.error("Couldn't create or find the professor user.");
    process.exit(1);
  }
  await admin.from("profiles").upsert({
    id: professorId,
    role: "professor",
    full_name: "Demo Professor",
    onboarding_complete: true,
  });

  // 2. Course.
  const { data: course, error: courseErr } = await admin
    .from("courses")
    .insert({
      professor_id: professorId,
      name: "Demo Course — Marketing Research",
      term: "Fall 2026",
      join_code: `DEM-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      icebreaker_fields: ["two_truths_and_a_lie", "first_job", "fun_fact"],
    })
    .select("id, join_code")
    .single();
  if (courseErr || !course) {
    console.error("Course insert failed:", courseErr?.message);
    process.exit(1);
  }

  // 3. 5x8 room.
  const seats = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 8; c++) {
      seats.push({
        course_id: course.id,
        label: `${rowLetter(r)}${c + 1}`,
        row_index: r,
        col_index: c,
      });
    }
  }
  await admin.from("seats").insert(seats);

  // 4. 30 synthetic roster rows.
  const roster = Array.from({ length: 30 }, (_, i) => ({
    course_id: course.id,
    roster_name: `${FIRST[i % 10]} ${LAST[Math.floor(i / 10) % 10]}${Math.floor(i / 10)}`,
    roster_email: `student${i + 1}@example.edu`,
    status: "invited" as const,
  }));
  await admin.from("enrollments").insert(roster);

  // 5. Open today's session.
  await admin.from("class_sessions").insert({
    course_id: course.id,
    session_date: new Date().toISOString().slice(0, 10),
  });

  console.log("Seeded demo classroom:");
  console.log(`  Course id:  ${course.id}`);
  console.log(`  Join code:  ${course.join_code}`);
  console.log(`  Professor:  ${professorEmail} (sign in via magic link)`);
  console.log(`  Roster:     30 synthetic students, 40-seat room, session open`);
}

main();
