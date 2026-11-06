// Prueba de velocidad del servidor (para saber DÓNDE se pierde el tiempo cuando algo tarda).
// Se abre con:  https://TU-DOMINIO/api/health?velocidad=1
// No toca la base del negocio ni el inventario: escribe y borra archivos de prueba en la carpeta de datos.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { DATA_DIR, db } from './db.js';

const ms = (t0) => Math.round((Number(process.hrtime.bigint() - t0) / 1e6) * 10) / 10;
let ultima = { t: 0, datos: null };

// 5 guardados (cada uno una transacción, como un cobro) en una base de prueba; devuelve el promedio y el peor, en ms
function guardados(modo) {
  const archivo = join(DATA_DIR, `.prueba_velocidad_${modo}.db`);
  const borrar = () => { for (const suf of ['', '-wal', '-shm']) { try { if (existsSync(archivo + suf)) unlinkSync(archivo + suf); } catch (e) { /* nada */ } } };
  borrar();
  const t = new DatabaseSync(archivo);
  try {
    t.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = ${modo}; CREATE TABLE p (id INTEGER PRIMARY KEY, x TEXT);`);
    const tiempos = [];
    for (let i = 0; i < 5; i++) {
      const t0 = process.hrtime.bigint();
      t.exec('BEGIN');
      for (let k = 0; k < 20; k++) t.prepare('INSERT INTO p (x) VALUES (?)').run('prueba');
      t.exec('COMMIT');
      tiempos.push(ms(t0));
    }
    return { promedio_ms: Math.round((tiempos.reduce((a, b) => a + b, 0) / tiempos.length) * 10) / 10, peor_ms: Math.max(...tiempos) };
  } finally {
    try { t.close(); } catch (e) { /* nada */ }
    borrar();
  }
}

export function medirVelocidad() {
  const ahora = Date.now();
  if (ultima.datos && ahora - ultima.t < 10000) return ultima.datos; // se repite cada 10 s como máximo

  const r = { node: process.version, memoria_mb: Math.round(process.memoryUsage().rss / 1048576), encendido_hace_min: Math.round(process.uptime() / 6) / 10 };

  let t0 = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) db.prepare('SELECT COUNT(*) AS c FROM products').get();
  r.leer_base_200_consultas_ms = ms(t0);

  try { r.guardar_como_ahora_NORMAL = guardados('NORMAL'); } catch (e) { r.guardar_como_ahora_NORMAL = { error: e.message }; }
  try { r.guardar_esperando_al_disco_FULL = guardados('FULL'); } catch (e) { r.guardar_esperando_al_disco_FULL = { error: e.message }; }

  t0 = process.hrtime.bigint();
  const h = createHash('sha256'); const bloque = randomBytes(1 << 20);
  for (let i = 0; i < 16; i++) h.update(bloque);
  h.digest('hex');
  r.procesador_16MB_sha256_ms = ms(t0);

  // Lo que cuesta verificar UNA contraseña en este servidor (es lo que se hace al entrar)
  try {
    const salt = randomBytes(16); const tiempos = [];
    for (let i = 0; i < 3; i++) { const t = process.hrtime.bigint(); scryptSync('prueba-de-velocidad', salt, 64); tiempos.push(ms(t)); }
    tiempos.sort((x, y) => x - y); r.verificar_contrasena_ms = tiempos[1];
  } catch (e) { r.verificar_contrasena_ms = null; }

  try { r.configuracion = { guardado: db.prepare('PRAGMA synchronous').get().synchronous === 1 ? 'NORMAL' : 'otro', modo: db.prepare('PRAGMA journal_mode').get().journal_mode }; } catch (e) { /* nada */ }

  // Lectura en palabras
  const full = r.guardar_esperando_al_disco_FULL && r.guardar_esperando_al_disco_FULL.promedio_ms;
  const normal = r.guardar_como_ahora_NORMAL && r.guardar_como_ahora_NORMAL.promedio_ms;
  const pistas = [];
  if (typeof full === 'number') pistas.push(full > 200 ? `El disco del servidor es LENTO al confirmar escrituras (${full} ms por guardado). Con el ajuste actual se ahorra gran parte (${normal} ms).` : `El disco responde bien (${full} ms por guardado).`);
  if (r.procesador_16MB_sha256_ms > 400) pistas.push(`El procesador del servidor es LENTO (${r.procesador_16MB_sha256_ms} ms; lo normal es menos de 100 ms).`);
  if (r.leer_base_200_consultas_ms > 150) pistas.push(`Leer la base es lento (${r.leer_base_200_consultas_ms} ms; lo normal es menos de 30 ms).`);
  if (typeof r.verificar_contrasena_ms === 'number' && r.verificar_contrasena_ms > 800) pistas.push(`Verificar una contraseña tarda ${r.verificar_contrasena_ms} ms (lo normal es menos de 300): entrar se siente lento.`);
  if (!pistas.length) pistas.push('El servidor está rápido. Si algo se ve lento, el atraso viene de la conexión de internet.');
  r.lectura = pistas;

  ultima = { t: ahora, datos: r };
  return r;
}

// Página que se abre en el NAVEGADOR de la tableta o del celular (https://TU-DOMINIO/api/health?velocidad=1):
// mide la conexión (ir y volver al servidor), el aparato y, con los datos de arriba, el servidor. Dice con palabras dónde está el atraso.
export function paginaVelocidad() {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prueba de velocidad</title>
<style>
  body{font:18px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:20px;background:#fafafa;color:#222;max-width:720px;margin-inline:auto}
  h1{font-size:26px;margin:0 0 4px} p.sub{margin:0 0 16px;color:#666}
  button{font:inherit;font-weight:700;padding:14px 22px;border:0;border-radius:12px;background:#e8590c;color:#fff;width:100%}
  .fila{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 12px;padding:12px 0;border-bottom:1px solid #ddd}
  .fila b{text-align:right;overflow-wrap:anywhere}.ok{color:#2b8a3e}.mal{color:#c92a2a}.reg{color:#e67700}
  .veredicto{margin:18px 0;padding:14px 16px;border-radius:12px;background:#fff;border:2px solid #ddd;font-weight:600}
  pre{white-space:pre-wrap;background:#fff;border:1px solid #ddd;border-radius:10px;padding:10px;font-size:14px}
</style></head><body>
<h1>⏱️ Prueba de velocidad</h1>
<p class="sub">Ábrela en la tableta o celular donde se pone lenta la pantalla. Dura unos 10 segundos; no toques nada.</p>
<button id="ir">Probar otra vez</button>
<div id="res"></div><div id="ver" class="veredicto" style="display:none"></div>
<p class="sub" id="copiar" style="display:none">Si quieres que lo revise, mándale una captura de esta pantalla a quien te ayuda con el sistema.</p>
<script>
(function(){
  var med=function(a){var s=a.slice().sort(function(x,y){return x-y});return s[Math.floor(s.length/2)]};
  var res=document.getElementById('res'), ver=document.getElementById('ver'), copiar=document.getElementById('copiar'), btn=document.getElementById('ir');
  function fila(txt,val,cls){res.insertAdjacentHTML('beforeend','<div class="fila"><span>'+txt+'</span><b class="'+(cls||'')+'">'+val+'</b></div>')}
  function esperar(ms){return new Promise(function(r){setTimeout(r,ms)})}
  async function ping(n){var t=[];for(var i=0;i<n;i++){var t0=performance.now();var r=await fetch('/api/health?x='+Date.now()+'_'+i,{cache:'no-store'});await r.text();t.push(performance.now()-t0);}return t}
  function cpu(){var t0=performance.now(),x=0;for(var i=0;i<30000000;i++){x+=Math.sqrt(i)%7}return performance.now()-t0+(x<0?1:0)}
  async function bajada(){var u='/js/app.js?x='+Date.now();var t0=performance.now();var r=await fetch(u,{cache:'no-store'});var b=await r.arrayBuffer();var ms=performance.now()-t0;
    var e=performance.getEntriesByType('resource').filter(function(x){return x.name.indexOf(u)>=0}).pop();var kb=((e&&e.transferSize)||b.byteLength)/1024;return {kb:kb,ms:ms}}
  async function correr(){
    btn.disabled=true;btn.textContent='Midiendo…';res.innerHTML='';ver.style.display='none';copiar.style.display='none';
    var malos=[],avisos=[];
    var p=await ping(8), pm=Math.round(med(p)), pw=Math.round(Math.max.apply(null,p));
    var cp=pm>400?'mal':pm>150?'reg':'ok';
    fila('📶 Conexión: ir y volver al servidor',pm+' ms (peor '+pw+' ms)',cp);
    if(cp==='mal') malos.push('La conexión a internet de este aparato es MUY lenta (cada petición tarda '+pm+' ms solo en ir y volver). Cada toque que necesita el servidor (cobrar, abrir mesas) se atrasa por eso.');
    else if(cp==='reg') avisos.push('La conexión es algo lenta ('+pm+' ms por petición). Si el WiFi está lejos del módem, acércate o usa otra red.');
    // Primera conexión de la página: buscar el dominio (DNS), conectar y seguridad (TLS), respuesta del servidor
    try{
      var nv=performance.getEntriesByType('navigation')[0];
      if(nv){
        var dns=Math.round(nv.domainLookupEnd-nv.domainLookupStart), con=Math.round(nv.connectEnd-nv.connectStart), tls=nv.secureConnectionStart>0?Math.round(nv.connectEnd-nv.secureConnectionStart):0, tcp=Math.max(0,con-tls), srv=Math.round(nv.responseStart-nv.requestStart);
        var cn=(dns>400||con>1200||srv>3000)?'mal':(dns>150||con>600||srv>1200)?'reg':'ok';
        fila('🔌 Abrir la conexión (la primera vez)','buscar el dominio '+dns+' ms · conectar '+tcp+' ms · seguridad '+tls+' ms · respuesta '+srv+' ms',cn);
        if(dns>400) (dns>1000?malos:avisos).push('Buscar el dominio tardó '+dns+' ms: el DNS del internet de este aparato es lento.');
        if(con>1200) malos.push('Abrir la conexión con el servidor tardó '+con+' ms: el internet de este aparato tarda en conectar (puede ser el proveedor).');
      }
    }catch(e){}
    // Enviar datos (POST), igual que al entrar: pide el login vacío, el servidor responde "faltan datos" al instante y no cuenta como intento
    try{
      var pp=[];for(var j=0;j<4;j++){var q0=performance.now();var rr=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'});await rr.text();pp.push(performance.now()-q0);}
      var pom=Math.round(med(pp)), cpo=pom>(pm*3+400)?'mal':pom>(pm*2+200)?'reg':'ok';
      fila('📤 Enviar datos al servidor (como al entrar)',pom+' ms (lo normal: parecido a la conexión, '+pm+' ms)',cpo);
      if(cpo==='mal') malos.push('Enviar datos tarda mucho más que pedirlos ('+pom+' ms contra '+pm+' ms): algo en la red o el servidor frena justo lo que hace "Entrar" y "Cobrar".');
    }catch(e){ fila('📤 Enviar datos al servidor','falló: '+e.message,'mal'); malos.push('No se pudo ni enviar datos de prueba al servidor.'); }
    await esperar(200);
    var d=await bajada(), kbs=d.kb/(d.ms/1000), cd=kbs<40?'mal':kbs<150?'reg':'ok';
    fila('⬇️ Descarga del programa ('+Math.round(d.kb)+' KB)',Math.round(d.ms)+' ms · '+Math.round(kbs*8/1000*10)/10+' Mbps',cd);
    if(cd==='mal') malos.push('La descarga es muy lenta: la pantalla tarda en abrir por el internet de este aparato.');
    await esperar(100);
    var c=Math.round(cpu()), cc=c>1200?'mal':c>500?'reg':'ok';
    fila('📱 Velocidad de este aparato',c+' ms (lo normal: menos de 400)',cc);
    if(cc==='mal') malos.push('Este aparato es MUY lento para procesar (tableta vieja o con muchas cosas abiertas). Ciérrale las demás aplicaciones y pestañas.');
    else if(cc==='reg') avisos.push('El aparato va algo justo de velocidad; cierra otras aplicaciones y pestañas.');
    var s=null;
    try{var r=await fetch('/api/health?velocidad=1&json=1',{cache:'no-store'});s=(await r.json()).velocidad}catch(e){}
    if(s){
      var w=s.guardar_esperando_al_disco_FULL&&s.guardar_esperando_al_disco_FULL.promedio_ms, n=s.guardar_como_ahora_NORMAL&&s.guardar_como_ahora_NORMAL.promedio_ms;
      var cw=w>400?'mal':w>120?'reg':'ok';
      fila('💾 Servidor: guardar en el disco',(n!=null?n:'?')+' ms (con el ajuste actual) · '+(w!=null?w:'?')+' ms (sin ajuste)',cw);
      if(cw==='mal') malos.push('El DISCO del servidor (Hostinger) es lento al guardar ('+w+' ms). Eso atrasa cada cobro. Con el ajuste de esta versión baja a '+n+' ms.');
      var sp=s.procesador_16MB_sha256_ms, csp=sp>600?'mal':sp>250?'reg':'ok';
      fila('🖥️ Servidor: procesador',sp+' ms (lo normal: menos de 150)',csp);
      if(csp!=='ok') (csp==='mal'?malos:avisos).push('El procesador del servidor va lento ('+sp+' ms): Hostinger lo tiene limitado en este momento o el plan es muy chico.');
      var rl=s.leer_base_200_consultas_ms, crl=rl>300?'mal':rl>100?'reg':'ok';
      fila('🗄️ Servidor: leer la base',rl+' ms (lo normal: menos de 30)',crl);
      if(crl!=='ok') (crl==='mal'?malos:avisos).push('Leer la base de datos tarda más de lo normal ('+rl+' ms).');
      var vc=s.verificar_contrasena_ms;
      if(typeof vc==='number'){var cvc=vc>1500?'mal':vc>500?'reg':'ok';
        fila('🔐 Servidor: verificar una contraseña (lo que cuesta entrar)',vc+' ms (lo normal: menos de 300)',cvc);
        if(cvc!=='ok') (cvc==='mal'?malos:avisos).push('Verificar la contraseña tarda '+vc+' ms en el servidor: por eso "Entrar" se demora. Hostinger tiene el procesador limitado.');}
      fila('ℹ️ Servidor encendido hace',(s.encendido_hace_min||0)+' min · memoria '+(s.memoria_mb||'?')+' MB','');
    } else { fila('🖥️ Servidor','no respondió la prueba','mal'); malos.push('El servidor no respondió la prueba completa.'); }
    try{
      var ul=JSON.parse(localStorage.getItem('mismisimo_ultimo_login')||'null');
      if(ul&&ul.total){
        var cul=ul.total>8000?'mal':ul.total>3000?'reg':'ok';
        fila('🚪 Último "Entrar" en este aparato',(Math.round(ul.total/100)/10)+' s en total · el servidor tardó '+(ul.servidor==null?'?':Math.round(ul.servidor)+' ms')+' · el resto fue la red',cul);
        if(cul!=='ok'&&ul.servidor!=null){ if(ul.servidor<ul.total*0.3) (cul==='mal'?malos:avisos).push('Entrar tardó '+(Math.round(ul.total/100)/10)+' s pero el servidor solo usó '+Math.round(ul.servidor)+' ms: el atraso está en la red entre la tableta y el servidor.'); else (cul==='mal'?malos:avisos).push('Entrar tardó '+(Math.round(ul.total/100)/10)+' s y la mayor parte fue del servidor ('+Math.round(ul.servidor)+' ms).'); }
      }
    }catch(e){}
    var txt;
    if(malos.length){ver.style.borderColor='#c92a2a';txt='🔴 Lo que está lento:<br>• '+malos.join('<br>• ')+(avisos.length?'<br>• '+avisos.join('<br>• '):'')}
    else if(avisos.length){ver.style.borderColor='#e67700';txt='🟠 Casi todo bien, pero:<br>• '+avisos.join('<br>• ')}
    else {ver.style.borderColor='#2b8a3e';txt='✅ Todo responde rápido en este momento. Si algo se ve lento ahorita, anota qué hacías y a qué hora.'}
    ver.innerHTML=txt;ver.style.display='';copiar.style.display='';
    btn.disabled=false;btn.textContent='Probar otra vez';
  }
  btn.onclick=correr; correr();
})();
</script></body></html>`;
}
