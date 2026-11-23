// Standalone STATIC preview package; excluded from the ordinary production build.
import { mkdirSync,readdirSync,copyFileSync,existsSync } from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=process.argv[2];if(!out)throw Error('Supply an empty output directory');
const target=resolve(out);if(target===root||target.startsWith(root+'/'))throw Error('Preview output must be outside source checkout');
if(existsSync(target)&&readdirSync(target).length)throw Error('Output must be empty');
mkdirSync(target,{recursive:true});
for(const name of ['index.html','partnership-preview.css','partnership-preview.js'])copyFileSync(join(root,'docs/previews/partnership',name),join(target,name));
copyFileSync(join(root,'styles.css'),join(target,'styles.css'));
