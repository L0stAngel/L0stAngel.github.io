const fs=require('fs'),path=require('path'),crypto=require('crypto');
const dir='verify/.tmp';
for(const f of fs.readdirSync(dir)){
  let src=fs.readFileSync(path.join(dir,f),'utf8');
  const i=src.indexOf('/*__VERIFY_INTERNALS__*/');
  if(i<0) continue;
  const j=src.indexOf('})();\n',i);
  let stripped=src.slice(0,i)+src.slice(j+6);
  const k=stripped.indexOf('/* verify: native require');
  if(k>0) stripped=stripped.slice(0,k);
  console.log(f, 'orig~', src.length, 'stripped', stripped.length, crypto.createHash('sha256').update(stripped).digest('hex').slice(0,16));
}