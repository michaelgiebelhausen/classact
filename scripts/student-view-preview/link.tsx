import type { AnchorHTMLAttributes } from 'react';
export default function Link({prefetch, ...props}: AnchorHTMLAttributes<HTMLAnchorElement> & {prefetch?: boolean}) { void prefetch; return <a {...props}/>; }
