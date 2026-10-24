const fs=require('fs'),crypto=require('crypto');
function strip(src){
  const i=src.indexOf('/*__VERIFY_INTERNALS__*/');
  const e=src.indexOf('/* ------------------------------ 导出接口');
  let out=src.slice(0,i)+src.slice(e);
  const k=out.lastIndexOf('/* verify: native require');
  if(k>0) out=out.slice(0,k);
  return out;
}
const candidates=['verify/.tmp/physics-134075c9affe1bf4.js','verify/.tmp/physics-ac5f10e49235c46f.js','verify/.tmp/physics-8b9bda31fd68b346.js','verify/.tmp/physics-66bff0d905b143ef.js'];
for(const f of candidates){
  const src=fs.readFileSync(f,'utf8');
  const out=strip(src);
  const h=crypto.createHash('sha256').update(out).digest('hex');
  console.log(f,'len',out.length,'hash',h.slice(0,16));
  if(h==='a903f959e1b33651ad2cd12efd4a6373d000e877828147da97350786301dfe87'){ fs.writeFileSync('verify/results/physics-a903-verified.js',out); console.log('SAVED a903'); }
}
