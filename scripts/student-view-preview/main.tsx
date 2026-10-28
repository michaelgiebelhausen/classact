import React from 'react';
import { createRoot } from 'react-dom/client';
import { StudentViewControls } from '../../src/components/features/StudentViewControls';
import { Sidebar } from '../../src/components/features/Sidebar';
import '../../src/app/globals.css';
const practicing=window.location.pathname.includes('/practice/');
createRoot(document.getElementById('root')!).render(<div className="flex min-h-screen">
  <Sidebar practiceIds={['practice']}/>
  <div className="min-w-0 flex-1">
    <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center gap-3 border-b bg-background px-4 py-2">
      <span className="text-lg font-medium">ClassAct</span><div className="ml-auto flex flex-wrap items-center gap-3"><StudentViewControls taught={['live']} practices={[{id:'practice',practice_source_id:'live',practice_routes:{a:'b'}}]}/><button className="rounded-md border px-3 py-2 text-sm">Sign out</button>{!practicing && <span className="text-sm">Fictional instructor</span>}</div>
    </header>
    <main className="grid gap-4 p-6"><p className="text-sm text-muted-foreground">Local UI fixture. Course creation is mocked; database isolation is tested separately.</p><h1 className="text-2xl font-semibold">Community research assignment</h1><p>{practicing?'Student assignment screen':'Instructor assignment screen'}</p><p>Use Student view, Practice options, Reset, and Exit to inspect the controls.</p></main>
  </div>
</div>);
