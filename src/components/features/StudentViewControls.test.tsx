import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { StudentViewControls } from './StudentViewControls';
const state=vi.hoisted(()=>({path:'/course/live/assignments/a', enter:vi.fn(), reopen:vi.fn()}));
vi.mock('next/navigation',()=>({usePathname:()=>state.path}));
vi.mock('@/server/actions/studentview',()=>({enterStudentView:state.enter,reopenPracticeAssignments:state.reopen}));
beforeEach(()=>{state.path='/course/live/assignments/a';vi.clearAllMocks();});
it('only offers entry on a course the instructor owns',()=>{
  const {rerender}=render(<StudentViewControls taught={[]} practices={[]}/>);
  expect(screen.queryByRole('button',{name:'Student view'})).toBeNull();
  rerender(<StudentViewControls taught={['live']} practices={[]}/>);
  expect(screen.getByRole('button',{name:'Student view'})).toBeInTheDocument();
});
it('shows an actionable error when entry fails',async()=>{
  state.enter.mockResolvedValue({ok:false,error:'Connection unavailable'});
  render(<StudentViewControls taught={['live']} practices={[]}/>);
  fireEvent.click(screen.getByRole('button',{name:'Student view'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable');
  expect(state.enter).toHaveBeenCalledWith('live',state.path,false,undefined);
});
it('returns to the matching instructor page and requires explicit reset confirmation',()=>{
  state.path='/course/practice/assignments/b';
  render(<StudentViewControls taught={['live']} practices={[{id:'practice',practice_source_id:'live',practice_routes:{a:'b'}}]}/>);
  expect(screen.getByRole('link',{name:'Exit student view'})).toHaveAttribute('href','/course/live/assignments/a');
  fireEvent.click(screen.getByText('Practice options'));
  fireEvent.click(screen.getByRole('button',{name:'Reset practice student'}));
  expect(state.enter).not.toHaveBeenCalled();
  expect(screen.getByText('Discard all practice work and take a fresh snapshot?')).toBeInTheDocument();
});
