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
      'Choose “Yes, they were there”, “They were not there”, or “I don’t remember”.',
      'Please only confirm if you remember. One confirmation gives them attendance credit.',
      'Opening this email or link does not submit a response.',
      '',
      '— ClassAct',
    ].join('\n'),
  };
}
