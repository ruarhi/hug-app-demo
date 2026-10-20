/* DEMO SITE (ruarhi/hug-app-demo): this page runs inside the shop's phone frame, a third-party
   iframe. A browser that refuses storage there would start the app signed out and empty, so
   fall back to storage in memory: the sample world only needs it for this visit. */
(function(){
  function mem(){ var d = {}; return {
    getItem: function(k){ return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; },
    setItem: function(k, v){ d[k] = String(v); }, removeItem: function(k){ delete d[k]; },
    clear: function(){ d = {}; }, key: function(i){ return Object.keys(d)[i] || null; },
    get length(){ return Object.keys(d).length; } }; }
  ['localStorage', 'sessionStorage'].forEach(function(n){
    try { var s = window[n]; s.setItem('__hug_probe', '1'); s.removeItem('__hug_probe'); }
    catch(e){ try { Object.defineProperty(window, n, { value: mem(), configurable: true }); } catch(_){} }
  });
})();
/* PROTO BUILD ONLY — never committed: open as the demo account, sample data, no backend */
try{var e="demo@hug.test";localStorage.setItem("hug-account-state-v1","active");localStorage.setItem("hug-account-email-v1",e);
localStorage.setItem("hug-prototype-access-v1",JSON.stringify({email:e,prototype:true,at:Date.now()}));localStorage.setItem("hug-demo-mode","on");}catch(x){}
