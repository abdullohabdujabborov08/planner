// Solih — jonli ovozli suhbat (Gemini Live).
// Telefon Gemini'ga toğridan-toğri ulanadi; server (Apps Script) faqat bir martalik ruxsatnoma beradi
// va Solihning qurollarini (kalendarni öqiş, tekşiriş, özgartiriş) bajaradi.
// app.js dagi api(), haptic(), toast(), ico() va currentRoute() dan foydalanadi.
(function () {
  const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
  const IN_RATE = 16000;   // Gemini'ga: 16 kHz PCM
  const OUT_RATE = 24000;  // Gemini'dan: 24 kHz PCM
  const VOICE = 'Achird';  // Abdulloh tanlagan ovoz
  const STYLE = 'dost';
  const TOOL_LABELS = {
    get_day_plan: ['calendar', 'Rejani körib çiqyapti'],
    check_time: ['clock', 'Vaqtni tekşiryapti'],
    add_task: ['plus', 'Kalendarga yozyapti'],
    move_task: ['arrow', 'Köçiryapti'],
    set_task_status: ['check', 'Belgilayapti'],
    change_block: ['repeat', 'Jadvalni özgartiryapti']
  };
  const WRITE_TOOLS = ['add_task', 'move_task', 'set_task_status', 'change_block'];
  const WORKLET = "class P extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('pcm-cap',P);";
  const el = (id) => document.getElementById(id);

  let ws = null;          // Gemini bilan aloqa
  let ready = false;      // sozlaş tugadimi
  let closing = false;    // foydalanuvçi özi yopyaptimi
  let ctx = null;         // ovoz konteksti (iPhone uçun tugma bosilganda yaratiladi)
  let mic = null;         // { stream, src, node, sink }
  let micOn = true;       // foydalanuvçi mikrofonni öçirmaganmi
  let pending = [];       // 16 kHz namunalar (yuboriliş kutilmoqda)
  let resPos = 0;
  let sources = [];       // çalinayotgan ovoz böläklari
  let nextTime = 0;
  let meUi = null, botUi = null;
  let changed = false;    // suhbatda kalendar özgardimi (yopilganda yangilaymiz)
  let workletUrl = null;

  // ---------- Oyna ----------

  function setState(s, text) {
    el('talk').dataset.state = s;
    el('talkState').textContent = text;
    el('talkHint').textContent = {
      connecting: 'Bir soniya…',
      listening: 'Gapiring — Solih eşityapti',
      thinking: 'Solih öylayapti…',
      speaking: 'Gapini bölib, gapirsangiz böladi',
      muted: 'Mikrofon öçiq — yoqiş uçun doirani bosing',
      off: 'Qayta ulaniş uçun doirani bosing'
    }[s] || '';
  }

  function bubble(cls, text) {
    const d = document.createElement('div');
    d.className = 'tmsg ' + cls;
    d.textContent = text;
    el('talkLog').appendChild(d);
    el('talkLog').scrollTop = el('talkLog').scrollHeight;
    return d;
  }

  function chip(icon, text) {
    const d = document.createElement('div');
    d.className = 'tchip';
    d.innerHTML = ico(icon) + '<span></span>';
    d.lastChild.textContent = text;
    el('talkLog').appendChild(d);
    el('talkLog').scrollTop = el('talkLog').scrollHeight;
  }

  function addText(who, text) {
    if (!text) return;
    if (who === 'me') { if (!meUi) meUi = bubble('me', ''); meUi.textContent += text; }
    else { if (!botUi) botUi = bubble('bot', ''); botUi.textContent += text; }
    el('talkLog').scrollTop = el('talkLog').scrollHeight;
  }

  /** «Solih bilan gaplaşiş» ikonkasi bosildi */
  function open() {
    el('talk').classList.remove('hidden');
    document.body.classList.add('talk-open');
    el('talkLog').innerHTML = '';
    meUi = null; botUi = null; changed = false; closing = false; micOn = true;
    haptic('light');
    // iPhone ovozni faqat tugma bosilgan zahoti yoqişga ruxsat beradi
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!ctx) ctx = new AC();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0);
    startMic();
    connect();
  }

  function close() {
    closing = true;
    stopMic();
    stopPlayback();
    if (ws) { try { ws.close(1000, 'yopildi'); } catch (e) { /* */ } }
    ws = null; ready = false;
    el('talk').classList.add('hidden');
    document.body.classList.remove('talk-open');
    if (changed) {
      // Kalendar özgargan bölsa, ekrandagi rejani yangilaymiz
      try {
        const r = currentRoute();
        if (r === 'home') loadHome();
        if (r === 'planner') loadPlanner();
      } catch (e) { /* */ }
    }
  }

  function fail(text) {
    setState('off', 'Ulanmagan');
    bubble('sys', text);
    stopPlayback();
    ws = null; ready = false;
  }

  // ---------- Ulaniş ----------

  async function connect() {
    setState('connecting', 'Ulanmoqda…');
    let r;
    try {
      r = await api('liveToken', { voice: VOICE, style: STYLE });
      if (!r.ok) throw new Error(r.error || 'Ulanib bölmadi');
    } catch (e) {
      fail('Ulanib bölmadi: ' + e.message);
      return;
    }
    if (closing) return;
    ws = new WebSocket(WS_URL + '?access_token=' + encodeURIComponent(r.token));
    ws.onopen = () => ws.send(JSON.stringify({ setup: { model: 'models/' + r.model } }));
    ws.onmessage = async (ev) => {
      let m;
      try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text()); } catch (e) { return; }
      onServer(m);
    };
    ws.onclose = (ev) => {
      ws = null; ready = false;
      if (!closing) fail('Aloqa uzildi' + (ev.reason ? ' (' + ev.reason + ')' : '') + '. Qayta ulaniş uçun doirani bosing.');
    };
  }

  function onServer(m) {
    if (m.setupComplete) {
      ready = true;
      setState(micOn && mic ? 'listening' : 'muted', 'Solih');
      // Solih suhbatni özi boşlaydi (bu matn ekranda körinmaydi)
      ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: '[BOŞLANDI]' }] }], turnComplete: true } }));
      return;
    }
    if (m.toolCall) { runTools(m.toolCall.functionCalls || []); return; }
    if (m.goAway) bubble('sys', 'Suhbat vaqti tugayapti. Uzilsa, doirani bosib qayta ulaning.');
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.interrupted) { stopPlayback(); botUi = null; }
    if (sc.inputTranscription && sc.inputTranscription.text) { botUi = null; addText('me', sc.inputTranscription.text); }
    if (sc.outputTranscription && sc.outputTranscription.text) { meUi = null; addText('bot', sc.outputTranscription.text); }
    ((sc.modelTurn && sc.modelTurn.parts) || []).forEach((p) => {
      if (p.inlineData && p.inlineData.data) play(p.inlineData.data);
    });
    if (sc.turnComplete) { meUi = null; botUi = null; }
  }

  /** Solih qurol çaqirdi: serverda bajaramiz va natijani qaytaramiz */
  async function runTools(calls) {
    setState('thinking', 'Solih');
    const responses = await Promise.all(calls.map(async (fc) => {
      const lb = TOOL_LABELS[fc.name] || ['sparkles', fc.name];
      chip(lb[0], lb[1]);
      let result;
      try {
        const r = await api('liveTool', { name: fc.name, args: fc.args || {} });
        result = r.result || r.error || 'Javob yöq';
      } catch (e) {
        result = 'XATO: ' + e.message;
      }
      if (WRITE_TOOLS.indexOf(fc.name) !== -1 && !/^XATO|topilmadi|Saqlanmadi/.test(result)) { changed = true; haptic('success'); }
      return { id: fc.id, name: fc.name, response: { result: result } };
    }));
    if (ws && ready) ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
  }

  function sendText(e) {
    e.preventDefault();
    const t = el('talkText').value.trim();
    if (!t) return;
    if (!ws || !ready) { toast('⚠️ Solih hali ulanmagan'); return; }
    stopPlayback();
    meUi = null; botUi = null;
    bubble('me', t);
    ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: t }] }], turnComplete: true } }));
    el('talkText').value = '';
  }

  /** Doira: ulanmagan bölsa — qayta ulaniş; ulangan bölsa — mikrofonni yoqiş/öçiriş */
  function orbTap() {
    haptic('light');
    if (!ws) { closing = false; if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); if (micOn && !mic) startMic(); connect(); return; }
    if (mic) { micOn = false; stopMic(); setState('muted', 'Mikrofon öçiq'); }
    else { micOn = true; startMic(); }
  }

  // ---------- Ovozni çaliş (24 kHz) ----------

  function play(b64) {
    const bin = atob(b64);
    const n = bin.length >> 1;
    const buf = ctx.createBuffer(1, n, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      if (v >= 32768) v -= 65536;
      ch[i] = v / 32768;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.03, nextTime);
    src.start(at);
    nextTime = at + buf.duration;
    sources.push(src);
    setState('speaking', 'Solih gapiryapti');
    src.onended = () => {
      sources = sources.filter((x) => x !== src);
      if (!sources.length && ws && el('talk').dataset.state === 'speaking') setState(mic ? 'listening' : 'muted', 'Solih');
    };
  }

  function stopPlayback() {
    sources.forEach((s) => { try { s.stop(); } catch (e) { /* */ } });
    sources = []; nextTime = 0;
  }

  // ---------- Mikrofon (16 kHz) ----------

  async function startMic() {
    if (mic) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (closing || !micOn) { stream.getTracks().forEach((t) => t.stop()); return; }
      const src = ctx.createMediaStreamSource(stream);
      const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
      let node;
      if (ctx.audioWorklet) {
        if (!workletUrl) {
          workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
          await ctx.audioWorklet.addModule(workletUrl);
        }
        node = new AudioWorkletNode(ctx, 'pcm-cap');
        node.port.onmessage = (e) => onSamples(e.data);
      } else {
        node = ctx.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = (e) => onSamples(e.inputBuffer.getChannelData(0).slice(0));
      }
      src.connect(node); node.connect(sink);
      mic = { stream: stream, src: src, node: node, sink: sink };
      pending = []; resPos = 0;
      if (ws && ready) setState('listening', 'Solih');
    } catch (e) {
      micOn = false;
      bubble('sys', 'Mikrofonga ruxsat yöq. Sozlamalar → Safari → Mikrofon. Hozirça yozib gaplaşing.');
      if (ws && ready) setState('muted', 'Mikrofon öçiq');
    }
  }

  function stopMic() {
    if (!mic) return;
    try {
      mic.stream.getTracks().forEach((t) => t.stop());
      mic.src.disconnect(); mic.node.disconnect(); mic.sink.disconnect();
    } catch (e) { /* */ }
    mic = null;
    el('talkOrb').style.setProperty('--lvl', 0);
    if (ws && ready) ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
  }

  /** 48 kHz → 16 kHz (örtaça) va doira "nafas olişi" uçun ovoz balandligi */
  function onSamples(input) {
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    if (el('talk').dataset.state === 'listening') el('talkOrb').style.setProperty('--lvl', Math.min(1, Math.sqrt(sum / input.length) * 6).toFixed(2));
    const ratio = ctx.sampleRate / IN_RATE;
    let pos = resPos;
    while (pos + ratio <= input.length) {
      const a = Math.floor(pos), b = Math.floor(pos + ratio);
      let s = 0;
      for (let i = a; i < b; i++) s += input[i];
      pending.push(s / Math.max(1, b - a));
      pos += ratio;
    }
    resPos = pos - input.length;
    if (pending.length >= 1600) flushMic(); // ~100 ms
  }

  function flushMic() {
    if (!ws || !ready) { pending = []; return; }
    const bytes = new Uint8Array(pending.length * 2);
    for (let i = 0; i < pending.length; i++) {
      const v = Math.max(-1, Math.min(1, pending[i]));
      const x = v < 0 ? v * 32768 : v * 32767;
      bytes[2 * i] = x & 255; bytes[2 * i + 1] = (x >> 8) & 255;
    }
    pending = [];
    let s = '';
    for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    ws.send(JSON.stringify({ realtimeInput: { audio: { data: btoa(s), mimeType: 'audio/pcm;rate=16000' } } }));
  }

  // ---------- Ulaş ----------

  function init() {
    ['talkBtn', 'talkBtn2'].forEach((id) => { const b = el(id); if (b) b.onclick = open; });
    el('talkClose').onclick = close;
    el('talkOrb').onclick = orbTap;
    el('talkForm').onsubmit = sendText;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el('talk').classList.contains('hidden')) close(); });
    // Ilova fonga ketsa (ekran qulflansa) — suhbatni yopamiz, mikrofon yonib qolmasin
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && !el('talk').classList.contains('hidden')) close(); });
  }
  init();
})();
