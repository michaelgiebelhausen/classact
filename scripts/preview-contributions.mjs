import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
const root = fileURLToPath(new URL("../", import.meta.url));
const preview = path.join(root,"scripts/contribution-preview");
// Reuse the built app's local font files when a production build is present.
let fontCss = "html{--font-sans:system-ui;--font-heading:Georgia;}";
try {
  const chunks = path.join(root,".next/static/chunks");
  for(const name of (await readdir(chunks)).filter(n=>n.endsWith(".css"))) {
    const css=await readFile(path.join(chunks,name),"utf8");
    const faces=css.match(/@font-face\{[^}]+\}/g) ?? [];
    fontCss+=faces.join("").replaceAll("../media/","/@fs/"+root.replaceAll("\\","/")+"/.next/static/media/");
  }
  fontCss+="html{--font-sans:'Hanken Grotesk',system-ui;--font-heading:'Fraunces',Georgia;}";
} catch { /* A preview also runs before a production build. */ }
const server = await createServer({
  plugins:[{name:"preview-fonts",transformIndexHtml(html){return html.replace("</head>",`<style>${fontCss}</style></head>`);}}],
  configFile:false,root:preview,
  server:{host:"127.0.0.1",port:4513,strictPort:true,fs:{allow:[root]}},
  esbuild:{jsx:"automatic"},
  css:{postcss:path.join(root,"postcss.config.mjs")},
  resolve:{alias:[
    {find:"@/server/actions/contributions",replacement:path.join(preview,"actions.ts")},
    {find:"next/navigation",replacement:path.join(preview,"navigation.ts")},
    {find:"@",replacement:path.join(root,"src")},
  ]},
});
await server.listen(); server.printUrls();
