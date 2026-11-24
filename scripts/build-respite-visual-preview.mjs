import {mkdirSync,readdirSync,copyFileSync} from 'node:fs';import {resolve,relative} from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),out=process.argv[2];
if(!out||!relative(root,resolve(out)).startsWith('..'))throw Error('Use an outside-checkout empty directory');
mkdirSync(out,{recursive:true});if(readdirSync(out).length)throw Error('Refuse nonempty output');
for(const f of ['index.html','preview.css'])copyFileSync(resolve(root,'docs/previews/respite',f),resolve(out,f));
for(const f of ['styles.css','logo-wordmark.png'])copyFileSync(resolve(root,f),resolve(out,f));
console.log('Four static files only; no Functions, forms, scripts or collection');
