export type LateResponse = 'confirm' | 'not_present' | 'unsure';

export function lateCheckinEmail(input: {
  studentName: string; courseName: string; date: string; seatLabel: string;
  topic: string | null; url: string;
}) {
  return {
    subject: `${input.courseName}: can you confirm attendance on ${input.date}?`,
    text: [
      `${input.studentName} says they attended ${input.courseName} on ${input.date} but forgot to check in.`,
      `They say they sat in seat ${input.seatLabel}, next to your recorded seat.`,
      ...(input.topic ? [`Lecture: ${input.topic}`] : []),
      '',
      'Do you remember them being there? Sign in to answer:',
      input.url,
      '',
      "Choose “I am confident that they were there.”, “I don't remember.”, or “To the best of my recollection, they were not there.”",
      'Please only confirm if you remember. One confirmation gives them attendance credit.',
      'Opening this email or link does not submit a response.',
      '',
      '— ClassAct',
    ].join('\n'),
  };
}

export const ATTENDANCE_PLEDGE = 'I attended this class on this date and sat in this seat. I understand that knowingly submitting false information violates the university’s academic integrity expectations and could subject me to university academic integrity proceedings.';
export const WITNESS_PLEDGE = 'I personally saw this classmate in class on this date. I understand that knowingly submitting false information violates the university’s academic integrity expectations and could subject me to university academic integrity proceedings.';
