const fs=require('fs');
for(const f of fs.readdirSync('verify/.tmp')){
  const p='verify/.tmp/'+f; const src=fs.readFileSync(p,'utf8');
  const i=src.indexOf('/*__VERIFY_INTERNALS__*/');
  const e=src.indexOf('/* ------------------------------ 导出接口');
  console.log(f, 'len',src.length, 'i',i, 'e',e, 'block', e-i, 'tail', src.slice(-80).replace(/\n/g,'|'));
}