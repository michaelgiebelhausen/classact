import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readFile,readdir} from 'node:fs/promises';
const root=fileURLToPath(new URL('../',import.meta.url));
const preview=path.join(root,'scripts/student-view-preview');
const fonts={name:'local-fonts',async transformIndexHtml(html){
  let css='html{--font-sans:system-ui;--font-heading:Georgia;}';
  try { for(const name of (await readdir(path.join(root,'.next/static/chunks'))).filter(n=>n.endsWith('.css'))) {
    const built=await readFile(path.join(root,'.next/static/chunks',name),'utf8');
    css+=(built.match(/@font-face\{[^}]+\}/g)??[]).join('').replaceAll('../media/','/@fs/'+root.replaceAll('\\','/')+'/.next/static/media/');
  } css+="html{--font-sans:'Hanken Grotesk',system-ui;--font-heading:'Fraunces',Georgia;}"; } catch { /* Before the first build, use local fallbacks. */ }
  return html.replace('</head>',`<style>${css}</style></head>`);
}};
const server=await createServer({plugins:[fonts],configFile:false,root:preview,server:{host:'127.0.0.1',port:4514,strictPort:true,fs:{allow:[root]}},esbuild:{jsx:'automatic'},css:{postcss:path.join(root,'postcss.config.mjs')},resolve:{alias:[
  {find:'@/server/actions/studentview',replacement:path.join(preview,'actions.ts')},
  {find:'next/navigation',replacement:path.join(preview,'navigation.ts')},
  {find:'next/link',replacement:path.join(preview,'link.tsx')},
  {find:'@',replacement:path.join(root,'src')},
]}});
await server.listen();server.printUrls();
