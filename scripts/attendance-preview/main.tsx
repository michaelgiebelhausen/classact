import React from 'react';
import { createRoot } from 'react-dom/client';
import { LateCheckin } from '../../src/components/features/checkin/LateCheckin';
import { AttendanceDays } from '../../src/components/features/checkin/AttendanceDays';
import '../../src/app/globals.css';
createRoot(document.getElementById('root')!).render(<main className="mx-auto grid max-w-4xl gap-6 p-6"><h1 className="text-2xl font-semibold">ClassAct attendance</h1><p className="text-sm text-muted-foreground">Local verification fixture. All records and actions are simulated.</p><LateCheckin courseId="fixture" sessions={[{id:'session',date:'2026-10-22'}]} seats={[{id:'seat',label:'B4'}]} mine={[]} incoming={[{id:'request',name:'Maya Chen',date:'2026-10-22',seat:'B5'}]} /><AttendanceDays courseId="fixture" days={[{date:'2026-10-20',excluded:false,reason:''},{date:'2026-10-22',excluded:true,reason:'Exam day'},{date:'2026-10-27',excluded:false,reason:''}]} /></main>);
