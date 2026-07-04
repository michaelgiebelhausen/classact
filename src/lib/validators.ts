import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.");

export const loginSchema = z.object({
  email: emailSchema,
});

export const joinSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4, "Enter your join code.")
    .transform((value) => value.toUpperCase()),
  email: emailSchema,
});

export const createCourseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Give the course a name students will recognize.")
    .max(120),
  term: z.string().trim().max(40).optional().or(z.literal("")),
});

export const seatGridSchema = z.object({
  rows: z.coerce.number().int().min(1).max(40),
  cols: z.coerce.number().int().min(1).max(40),
});

export const icebreakerFieldsSchema = z.array(z.string().min(1)).max(12);

export const rosterRowSchema = z.object({
  name: z.string().trim().min(1, "Missing name").max(120),
  email: emailSchema,
});

export const gameScoreSchema = z.object({
  courseId: z.string().uuid(),
  gameType: z.enum(["memory_tiles", "flash_cards"]),
  score: z.number().int().min(0).max(10000),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type JoinInput = z.infer<typeof joinSchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
