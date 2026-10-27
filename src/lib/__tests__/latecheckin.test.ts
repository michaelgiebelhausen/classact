import { describe, expect, it } from 'vitest';
import { lateCheckinEmail } from '../latecheckin';

const input = { studentName: 'Maya Chen', courseName: 'Marketing Research', date: '2026-09-15', seatLabel: 'B4', topic: null, url: 'https://example.test/course/course/checkin#late-checkin' };
describe('late attendance email', () => {
  it('includes the claimed date and seat, and a signed-in response link', () => {
    const email = lateCheckinEmail(input);
    expect(email.text).toContain('Maya Chen');
    expect(email.text).toContain('2026-09-15');
    expect(email.text).toContain('seat B4');
    expect(email.text).toContain(input.url);
    expect(email.text).toContain('One confirmation');
    expect(email.text).toContain('does not submit a response');
    expect(email.text).not.toContain('Lecture:');
  });
  it('includes a known lecture title only when available', () => {
    expect(lateCheckinEmail({ ...input, topic: 'Sampling methods' }).text).toContain('Lecture: Sampling methods');
  });
});
