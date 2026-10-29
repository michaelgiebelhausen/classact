export async function requestLateCheckin() { return {ok:false,error:'No recorded neighbors are available to vouch for this seat.'}; }
export async function pledgeLateCheckin() { return {ok:true}; }
export async function respondLateCheckin() { return {ok:true}; }
export async function retryLateCheckinEmails() { return {ok:true}; }
export async function setAttendanceDays() { return {ok:true}; }
export async function getMyAttendanceHistory() { return {ok:true,data:{today:'2026-10-29',rows:[
{date:'2026-10-27',checkin:'None recorded',attendance:'Absence excuse requested',detail:'Your absence request is on file. No check-in or attendance pledge is needed.',absence:'Absence excuse requested'},
{date:'2026-10-22',checkin:'Recorded',attendance:'Present · confirmed',detail:'Recorded by your university academic integrity pledge.',absence:null},
{date:'2026-10-20',checkin:'None recorded',attendance:'Absence appeal pending',detail:'Your appeal is pending.',absence:'Absence appeal pending'}
]}}; }
