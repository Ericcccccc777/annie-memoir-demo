const P = JSON.parse(document.getElementById("prompts").textContent);
const SAMPLE = JSON.parse(document.getElementById("samplebook").textContent);
const $ = id => document.getElementById(id);
const esc = s => { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; };

// 美元，2026-11-04 查的公开价。LLM：未命中输入、缓存读、缓存写、输出（每百万 token）
const PRICE = {
  eleven: 0.08, mobile: 0.075, landline: 0.0252, audPerUsd: 1 / 0.6966,
  models: {
    "Sonnet 5.5": [2, .1, 2.5, 10], "GPT-6.1 Sol": [2, .1, 2, 10], "Haiku 5.5": [.1, .01, .125, .5], "GPT-6 Luna": [.1, .01, .1, .5],
    "Gemini Flash-Lite": [.1, .01, .1, .4], "DeepSeek 低峰": [.15, .003, .15, .6],
  },
};
const HIDDEN_THINKING = 120; // 每轮隐藏思考的输出 token，取自真实中文通话的平均值
const WRITING_PER_CALL = 0.45; // Wren 写一章的模型费，模拟估算

const PICTURES = {
  home: ["家里的厨房，卡尔顿，约 1935 年", "A kitchen in Carlton, about 1935", "维多利亚州立图书馆"],
  school: ["学校门前的师生，1924 年", "A teacher and pupils at a bush school, 1924", "昆士兰州立图书馆"],
  puffing: ["小火车进站，约 1930 年", "A steam train at Emerald, Victoria, about 1930", "公版"],
  station: ["等火车的人们，芒特艾萨，1931 年", "Waiting for the train at Mount Isa, 1931", "昆士兰州立图书馆"],
  ward: ["医院的护士和婴儿，1930 年代", "Hospital sisters with babies, 1930s", "新南威尔士州立图书馆"],
  street: ["墨尔本柯林斯街，1930 年", "Collins Street, Melbourne, 1930", "公版"],
  wedding: ["走出教堂的新人，1934 年", "A couple leaving the church, 1934", "新南威尔士州立图书馆"],
  coast: ["海滩上走路的老人，1930 年", "An old man walking the beach, 1930", "澳大利亚国家海事博物馆"],
  beach: ["海滩上的一家人，1938 年", "A family at Burleigh Heads, 1938", "昆士兰州立图书馆"],
};
const CALL_PICTURE = { 1: "street", 2: "home", 3: "school", 4: "ward", 5: "wedding", 6: "coast", 7: "beach", 8: "station" };
const TAILS = { 1: "A short opening chapter: who this person is and why they agreed to this", 2: "1. Where I come from", 3: "2. Growing up", 4: "3. What I did", 5: "4. The people I love", 6: "5. The hard days", 7: "6. The good times", 8: "7. What I want you to know, ending with any words for named people" };

function tokens(text) {
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  return Math.ceil(cjk * 1.6 + (text.length - cjk) / 4);
}
function speakSeconds(text) {
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (text.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9']+/g) || []).length;
  return words / 130 * 60 + cjk / 240 * 60;
}
const fmtClock = s => { s = Math.floor(s); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
function usage(system, turns) {
  const u = { read: 0, write: tokens(system), output: 0, requests: 0 };
  let history = tokens(system), fresh = 0;
  for (const t of turns) {
    fresh += tokens(t.text);
    if (t.who === "annie") {
      u.requests++;
      if (u.requests > 1) { u.read += history; u.write += fresh; }
      history += fresh; fresh = 0;
      u.output += tokens(t.text) + HIDDEN_THINKING;
    }
  }
  return u;
}
const billModel = () => window.STANDALONE?.billModel() || "Sonnet 5.5";
function llmCost(u, name) { const [, r, w, o] = PRICE.models[name]; return (u.read * r + u.write * w + u.output * o) / 1e6; }
function billFor({ seconds, phone, system, turns, brief, transcript }) {
  const minutes = seconds / 60, line = Math.ceil(minutes) * PRICE[phone], voice = minutes * PRICE.eleven;
  const call = usage(system, turns);
  const after = brief ? { read: 0, write: tokens(P.postCall + transcript + system.slice(0, 900)), output: tokens(brief) + 300 } : { read: 0, write: 0, output: 0 };
  const llmFor = n => llmCost(call, n) + llmCost(after, n);
  const llm = llmCost(call, billModel()), notes = llmCost(after, billModel());
  return { minutes, line, voice, llm, notes, llmFor, call, total: line + voice + llm + notes };
}
const usd = n => "US$" + n.toFixed(n < 0.1 ? 4 : 3);
const aud = n => "A$" + (n * PRICE.audPerUsd).toFixed(2);
function renderBill(b, o) {
  const row = (name, sub, amt) => `<div class="row"><span>${name}</span><span class="dots"></span><span class="amt">${usd(amt)}</span></div><div class="sub">${sub}</div>`;
  const others = Object.keys(PRICE.models).filter(n => PRICE.models[n][3] < PRICE.models[billModel()][3]);
  $("bill").innerHTML = `<h2>${o.title}</h2>${o.example ? '<p class="tag">这是示例，挂断后这里会换成你的通话。</p>' : ""}
    ${row("Twilio 电话线路", `${Math.ceil(b.minutes)} 分钟，每分钟 $${PRICE[o.phone]}`, b.line)}
    ${row("ElevenLabs 语音", `${b.minutes.toFixed(1)} 分钟，每分钟 $${PRICE.eleven}`, b.voice)}
    ${row(`${billModel()} 对话`, `约 ${b.call.requests} 次回复`, b.llm)}
    ${row(`${billModel()} 整理 brief`, "每通结束后一次", b.notes)}
    <div class="row total"><span>这一通</span><span class="dots"></span><span class="amt">${aud(b.total)}</span></div>
    <div class="sub">${usd(b.total)}。8 通约 ${aud(b.total * 8)}，不含写书、编辑和印刷。</div>
    <h2 style="margin-top:30px">换成便宜模型，模型这一项是</h2>
    <div class="alt">${others.map(n => `<span>${n} <b>${usd(b.llmFor(n))}</b></span>`).join("")}</div>
    <p class="fine">这是按公开价估算的金额，不是实际扣费。价格查于 2026-11-04。</p>
    ${o.outcome ? `<p class="fine">通话结果：${esc(o.outcome)}</p>` : ""}
    ${o.briefText ? `<details><summary>给下一通看的 brief</summary><pre>${esc(o.briefText)}</pre></details>` : ""}
    ${o.example ? "" : `<div class="wren-line" id="wren-line">${o.wren || ""}</div>`}
    ${o.example ? "" : '<div class="actions" style="margin-top:18px;justify-items:start"><button class="btn quiet" id="save" type="button">保存转写稿</button></div>'}`;
  if ($("save")) $("save").onclick = saveTranscript;
}

// 通话
let sample = null, downloads = null, lang = "en", live = false, busy = false, ctl = null;
let turns = [], messages = [], skipped = 0, system = "", callNo = 1;
async function connect() {
  if (!window.claude) return null;
  sample = sample || await claude.use("sample");
  downloads = downloads || await claude.use("downloads").catch(() => null);
  return sample;
}
const personKey = () => `${$("name").value.trim()}:${lang}`;
function load(kind) { try { return JSON.parse(localStorage.getItem(`${kind}:${personKey()}`)) || {}; } catch { return mem[`${kind}:${personKey()}`] || {}; } }
const mem = {};
function keep(kind, v) { mem[`${kind}:${personKey()}`] = v; try { localStorage.setItem(`${kind}:${personKey()}`, JSON.stringify(v)); } catch {} }
function refreshMemory() {
  const done = Object.keys(load("brief")).map(Number);
  $("memory").textContent = done.length ? `已聊过第 ${done.join("、")} 通` : "";
  if (done.length && !live) $("call").value = Math.min(Math.max(...done) + 1, 8);
  renderShelf();
}
function profile() {
  const name = $("name").value.trim(), family = $("family").value.trim(), rel = $("relation").value.trim();
  return `Storyteller's name: ${name}\nFull name: ${$("full").value.trim()}\nCourtesy check: ${family} is their ${rel}\nArranged by: ${family}, their ${rel}\nNext call: same time next week\nTopics to handle gently: none listed`;
}
function buildSystem(n) {
  const last = load("brief")[n - 1];
  const parts = [P.core, P.calls[n], "# Storyteller profile\n\n" + profile(), "# Brief from earlier calls\n\n" + (last || (n === 1 ? "This is your first call." : "No brief is available for this practice call."))];
  const gaps = load("gaps").text;
  if (gaps && gaps.trim() !== "None") parts.push("# Questions from Wren for this call\n\n" + gaps);
  if (lang === "zh") parts.push(P.zh);
  return parts.join("\n\n");
}
function elapsed() { let s = skipped * 60; for (const t of turns) s += speakSeconds(t.text) + 8; return s; }
const tick = () => { $("clock").textContent = fmtClock(elapsed()); };
function bubble(who, text) {
  const el = document.createElement("div"); el.className = "say " + who;
  const w = document.createElement("span"); w.className = "who"; w.textContent = who === "annie" ? "Annie" : "你";
  const t = document.createElement("span"); t.textContent = text;
  el.append(w, t); $("log").append(el); $("log").scrollTop = $("log").scrollHeight; return t;
}
function note(text, cls = "") { const el = document.createElement("p"); el.className = "note " + cls; el.textContent = text; $("log").append(el); $("log").scrollTop = $("log").scrollHeight; return el; }
function setBusy(b) { busy = b; $("text").disabled = $("send").disabled = !live || b; $("skip").disabled = !live; $("hang").disabled = !live; if (live && !b && !voiceOn) $("text").focus(); }
function setLive(b) {
  live = b; $("start").disabled = b;
  for (const id of ["call", "name", "full", "family", "relation", "phone", "lang-en", "lang-zh"]) $(id).disabled = b;
  $("state").textContent = b ? "通话中" : "已挂断"; $("state").classList.toggle("live", b); $("state").classList.remove("listening"); $("voice-test").hidden = b || !voiceOn; setBusy(false);
}
const COPY = { no_key: "先在左边填 API key。", bad_key: "这个 API key 不对，检查一下有没有复制完整。", no_credit: "这个 API 账户余额不够，到平台充值后再试。订阅额度不能用在 API 上。", forbidden: "这个 key 没有权限，或者所在地区用不了这项服务。", bad_model: "这个账户用不了需要的模型。", bad_request: "请求被拒绝了，换一下说法再试。", network: "连不上模型服务，检查一下网络。", openai_blocked: "连不上 OpenAI。最常见的原因是 API key 不对，也可能是 OpenAI 这会儿不接受浏览器直连，可以换 Claude API 试试。", not_granted: "你没有允许这个页面使用 Claude。重新打开页面后可以再选一次。", sampling_disabled: "这个账号现在不能使用这项功能。", rate_limited: "模型用量到上限或请求太快，稍等一下再试。", session_expired: "登录已过期，请重新登录 Claude。", refused: "模型拒绝了这条内容，换个说法再试。", empty_completion: "这轮没有回复，请再发一次。" };
function complain(e) { if (e.code !== "cancelled") note(COPY[e.code] || "连接中断了，请再试一次。", "err"); }
// 语音：Annie 用浏览器朗读；你用语音识别，这个窗口用不了麦克风时改用系统听写
const SR = window.SpeechRecognition || window.webkitSpeechRecognition, PAUSE = 3000, IDLE = 60000;
const DICTATE = window.STANDALONE
  ? "这个浏览器现在听不到麦克风。请在地址栏允许麦克风，或者换 Chrome、Edge、Safari。也可以用系统听写：Mac 按两下 Fn，手机点键盘上的麦克风，说完停 3 秒自动发送。"
  : "这个页面用不了麦克风，是 Claude 页面的限制。你用系统听写来说：Mac 按两下 Fn，手机点键盘上的麦克风。说完停 3 秒自动发送。";
let voiceOn = false, micMode = "off";
function micAllowed() { const p = document.permissionsPolicy || document.featurePolicy; try { return p ? p.allowsFeature("microphone") : null; } catch { return null; } }
const NOVELTY = /Eddy|Flo\b|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph/i;
function pickVoice() {
  if (!("speechSynthesis" in window)) return null;
  const order = lang === "zh" ? [/^zh[-_]CN/i, /^zh/i] : [/^en[-_]AU/i, /^en[-_]GB/i, /^en/i];
  const voices = speechSynthesis.getVoices().filter(v => !NOVELTY.test(v.name));
  for (const w of order) {
    const m = voices.filter(v => w.test(v.lang));
    if (m.length) return m.find(v => /Premium|Enhanced|Natural|Neural/i.test(v.name)) || m.find(v => /Karen|Tingting|Ting-Ting|Google/i.test(v.name)) || m[0];
  }
  return null;
}
function describeVoice() {
  if (!voiceOn) { $("voice-note").textContent = ""; return; }
  const v = pickVoice(), talk = "speechSynthesis" in window ? (v ? `Annie 用 ${v.name} 的声音读出来。` : "Annie 会读出来。") : "这个窗口读不了声音。";
  $("voice-note").textContent = noMic() ? `${talk}${DICTATE}` : `${talk}接通后允许麦克风，你就能直接说，停 3 秒自动发送。${window.STANDALONE ? "你说的话由浏览器厂商的服务转成文字。" : ""}`;
  $("voice-test").hidden = !("speechSynthesis" in window) || live;
}
const noMic = () => !SR || ear.dead || micAllowed() === false;
function testVoice() { // 打电话之前先听一句，确认这个窗口放得出声音
  const b = $("voice-test"), v = pickVoice(), u = new SpeechSynthesisUtterance(lang === "zh" ? "您好，我是 Annie。" : "Hello, this is Annie.");
  if (v) u.voice = v;
  u.lang = v?.lang || (lang === "zh" ? "zh-CN" : "en-AU"); u.rate = .96; b.disabled = true; b.textContent = "正在读…";
  let over = false;
  const end = text => { if (over) return; over = true; clearTimeout(guard); b.disabled = false; b.textContent = text; };
  const guard = setTimeout(() => { try { speechSynthesis.cancel(); } catch {} end("没有读出来，再试一次"); }, 7000);
  u.onend = () => end("读完了，再听一次"); u.onerror = () => end("没有读出来，再试一次");
  try { speechSynthesis.cancel(); speechSynthesis.resume(); speechSynthesis.speak(u); testVoice.last = u; } catch { end("没有读出来，再试一次"); }
}
// 系统听写不按键盘，文字直接进输入框；停 3 秒自动发送，手动打字不受影响
let lastKey = 0, dictating = 0;
function afterInput() {
  clearTimeout(dictating);
  if (!voiceOn || !live || busy || !noMic() || Date.now() - lastKey < 800) return;
  dictating = setTimeout(() => { const el = $("text"); el.blur(); if (el.value.trim()) $("form").requestSubmit(); }, PAUSE); // 先失焦，让听写把文字交齐
}
function showState(text, hearing = false) { if (!live) return; $("state").textContent = text; $("state").classList.toggle("listening", hearing); }
function setMic(m) { micMode = m; $("mic").hidden = m === "off"; $("mic").textContent = { speaking: "打断", listening: "说完了", idle: "开始说话" }[m] || ""; }
function unlockSpeech() { try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch {} } // 手机要在点击时先解锁
// 把流式文字切成句子，一句一句念，避免长句被浏览器中途截断
const speech = (() => {
  let said = 0, queue = [], playing = false, muted = false, current = null, waiting = [];
  const settle = () => { if (playing || queue.length) return; const w = waiting; waiting = []; w.forEach(r => r()); };
  function play() {
    if (playing || muted) return;
    const s = queue.shift();
    if (!s) { settle(); return; }
    playing = true;
    const u = new SpeechSynthesisUtterance(s), v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang || (lang === "zh" ? "zh-CN" : "en-AU"); u.rate = .96; current = u;
    let over = false;
    const next = () => { if (over) return; over = true; clearTimeout(guard); playing = false; play(); };
    const guard = setTimeout(() => { try { speechSynthesis.cancel(); } catch {} next(); }, s.length * (lang === "zh" ? 320 : 110) + 5000);
    u.onend = u.onerror = next;
    showState("Annie 在说话"); setMic("speaking");
    try { speechSynthesis.resume(); speechSynthesis.speak(u); } catch { next(); }
  }
  return {
    reset() { said = 0; queue = []; muted = false; },
    feed(text, final = false) {
      if (!voiceOn || muted || !("speechSynthesis" in window)) return;
      const cut = text.indexOf("["), clean = cut < 0 ? text : text.slice(0, cut);
      for (;;) {
        const m = clean.slice(said).match(/^[\s\S]*?(?:[.!?…]+["”’)]*\s+|[。！？…]+[”’）]*)/);
        if (!m) break;
        said += m[0].length; if (m[0].trim()) queue.push(m[0].trim());
      }
      if (final) { const rest = clean.slice(said).trim(); said = clean.length; if (rest) queue.push(rest); }
      play();
    },
    done() { return new Promise(r => { if (!playing && !queue.length) r(); else waiting.push(r); }); },
    cancel() { muted = true; queue = []; try { speechSynthesis.cancel(); } catch {} playing = false; current = null; settle(); },
  };
})();
const ear = { rec: null, on: false, dead: false, hinted: false, text: "", base: "", pause: 0, idle: 0, began: 0, quick: 0 };
function stopEar() {
  ear.on = false; clearTimeout(ear.pause); clearTimeout(ear.idle);
  if (ear.rec) { const r = ear.rec; ear.rec = null; r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch {} }
  $("state").classList.remove("listening");
}
function micFailed() {
  ear.dead = true; stopEar(); setMic("off"); showState("通话中"); describeVoice();
  if (!ear.hinted) { ear.hinted = true; note(DICTATE); }
  if (live && !busy) $("text").focus();
}
function commit() {
  const t = ear.text.trim(); stopEar();
  if (t) { $("text").value = t; $("form").requestSubmit(); } else { setMic("idle"); showState("通话中"); }
}
function hearOn() {
  const r = ear.rec = new SR();
  r.lang = lang === "zh" ? "zh-CN" : "en-AU"; r.continuous = !/Android/i.test(navigator.userAgent); r.interimResults = true;
  r.onresult = e => {
    let s = ""; for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
    ear.text = ear.base ? ear.base + (lang === "zh" ? "" : " ") + s.trim() : s.trim();
    $("text").value = ear.text; $("text").scrollTop = $("text").scrollHeight;
    clearTimeout(ear.idle); clearTimeout(ear.pause); ear.pause = setTimeout(commit, PAUSE);
  };
  r.onerror = e => { if (["not-allowed", "service-not-allowed", "network", "audio-capture", "language-not-supported"].includes(e.error)) micFailed(); };
  r.onend = () => { // 浏览器过一阵会自己停，这里接着听
    if (!ear.on) return;
    ear.quick = Date.now() - ear.began < 400 ? ear.quick + 1 : 0;
    if (ear.quick >= 3) { micFailed(); return; }
    ear.base = ear.text; hearOn();
  };
  ear.began = Date.now();
  try { r.start(); } catch { micFailed(); }
}
function listen() {
  if (!voiceOn || !live || busy || ear.on) return;
  if (noMic()) { micFailed(); return; }
  ear.on = true; ear.text = ear.base = ""; ear.quick = 0;
  ear.idle = setTimeout(() => { stopEar(); setMic("idle"); showState("通话中"); }, IDLE);
  setMic("listening"); showState("在听你说", true); hearOn();
}
function setVoice(on) {
  voiceOn = on; $("mode-type").setAttribute("aria-pressed", !on); $("mode-voice").setAttribute("aria-pressed", on);
  if (on) { unlockSpeech(); describeVoice(); listen(); return; }
  speech.cancel(); stopEar(); clearTimeout(dictating); setMic("off"); describeVoice(); $("voice-test").hidden = true; showState("通话中");
  if (live && !busy) $("text").focus();
}
async function annieTurn() {
  setBusy(true); stopEar(); setMic("off"); showState("通话中");
  const thinking = note("Annie 在想…");
  const clock = `Call clock: ${fmtClock(elapsed()).replace(/^0/, "")} elapsed.`;
  const last = messages[messages.length - 1];
  const input = [{ role: "user", content: system }, ...messages.slice(0, -1), { role: "user", content: `${last.content}\n\n(${clock})` }];
  ctl = new AbortController();
  let node = null;
  speech.reset();
  try {
    const { text } = await sample(input, { model: "claude-sonnet-5-5", effort: "low", cache: false, signal: ctl.signal,
      onText: ({ text }) => { thinking.remove(); node = node || bubble("annie", ""); node.textContent = text.replace("[END_CALL]", "").trim(); speech.feed(text); } });
    thinking.remove();
    messages.push({ role: "assistant", content: text });
    turns.push({ who: "annie", text: text.replace("[END_CALL]", "").trim() });
    tick();
    speech.feed(text, true); await speech.done();
    if (!live) return;
    if (text.includes("[END_CALL]")) return finish("Annie 道别后挂断了。");
  } catch (e) { thinking.remove(); complain(e); }
  setBusy(false);
  if (live) { showState("通话中"); setMic("off"); listen(); }
}
async function start() {
  if (voiceOn) unlockSpeech();
  if (window.STANDALONE && !STANDALONE.ready()) { STANDALONE.ask(); note(COPY.no_key, "err"); return; }
  if (!await connect()) { note("这个页面要在 Claude 里打开才能对话。", "err"); return; }
  callNo = Number($("call").value); system = buildSystem(callNo);
  turns = []; skipped = 0; messages = [{ role: "user", content: "[The call has connected and they have picked up. Speak first.]" }];
  $("log").textContent = ""; $("clock").textContent = "00:00"; setLive(true);
  await annieTurn();
}
async function send(e) {
  e.preventDefault();
  const text = $("text").value.trim();
  if (!text || busy || !live) return;
  stopEar(); clearTimeout(dictating);
  $("text").value = ""; bubble("you", text); turns.push({ who: "you", text }); messages.push({ role: "user", content: text }); tick();
  await annieTurn();
}
const transcriptText = () => turns.map((t, i) => `T${String(i + 1).padStart(3, "0")} ${t.who === "annie" ? "Annie" : "Storyteller"}: ${t.text}`).join("\n\n");
async function finish(reason) {
  speech.cancel(); stopEar(); setMic("off");
  ctl?.abort(); setLive(false); note(reason);
  const seconds = elapsed(), phone = $("phone").value, transcript = transcriptText();
  const show = (briefText, outcome, wren) => renderBill(billFor({ seconds, phone, system, turns, brief: briefText, transcript }), { phone, title: `第 ${callNo} 通话费单，${fmtClock(seconds)}`, briefText, outcome, wren });
  show("", "", "");
  if (turns.filter(t => t.who === "you").length < 2) { note("这通说得太少，不写进书。"); return; }
  let briefText = "", outcome = "";
  const wait = note("正在整理 brief…");
  try {
    const briefs = load("brief");
    const { text } = await sample([P.postCall, "# Storyteller profile\n\n" + profile(), "# This call's plan\n\n" + P.calls[callNo], "# Brief so far\n\n" + (briefs[callNo - 1] || "None."), "# Transcript\n\n" + transcript].join("\n\n"), { model: "claude-sonnet-5-5", effort: "low", cache: false });
    briefs[callNo] = text; keep("brief", briefs); briefText = text;
    outcome = (text.match(/## Call outcome\s+([^\n]+)/) || [])[1] || "";
    wait.remove();
  } catch (e) { wait.remove(); complain(e); }
  show(briefText, outcome, '<span class="note">Wren 正在写这一章，大约一两分钟。</span>');
  await wrenWrite(transcript);
  show(briefText, outcome, load("book")[callNo] ? '<button class="btn go" id="open-book" type="button">翻开这本书</button>' : "");
  if ($("open-book")) $("open-book").onclick = () => { bookSource = "mine"; pendingChapter = callNo; location.hash = "book"; };
}
async function wrenWrite(transcript) {
  const book = load("book");
  const before = Object.keys(book).sort((a, b) => a - b).map(n => book[n].md).join("\n\n") || "None yet.";
  const list = Object.keys(PICTURES).map(id => `${id}: ${PICTURES[id][1]}`).join("\n");
  const prompt = [P.craft, P.draft, `Write this chapter: ${TAILS[callNo]}`, "There is no ledger in this version: use the transcript below as your source for everything.",
    "# Book plan\n\n" + P.bookPlan, "# Profile\n\n" + profile(), "# Chapters so far\n\n" + before, `# Transcript of call ${callNo}\n\n` + transcript,
    "# Pictures available\n\n" + list,
    `Output format: the first line is PICTURE: followed by the id of the picture that best suits the chapter (default ${CALL_PICTURE[callNo]}). Then a blank line. Then the chapter in Markdown, starting with a # title line.`,
    `After the chapter, add a line with only ===GAPS=== and then, as a list, up to three short questions Annie should ask next time to deepen stories told here, in the storyteller's own phrases, or None.`].join("\n\n");
  try {
    const { text } = await sample(prompt, { model: "claude-opus-5-5", modelTier: "complex", effort: "medium", cache: false });
    const [chapter, gaps] = text.split(/^===GAPS===\s*$/m);
    const pic = (chapter.match(/^PICTURE:\s*(\w+)/m) || [])[1];
    const md = chapter.replace(/^PICTURE:.*$/m, "").trim();
    const title = (md.match(/^#\s+(.+)$/m) || [, `第 ${callNo} 章`])[1];
    book[callNo] = { title, md: md.replace(/^#\s+.+$/m, "").trim(), pic: PICTURES[pic] ? pic : CALL_PICTURE[callNo] };
    keep("book", book); keep("gaps", { text: (gaps || "None").trim() });
    refreshMemory();
  } catch (e) { complain(e); }
}
async function saveTranscript() {
  const data = `# 第 ${callNo} 通\n\n` + transcriptText() + "\n";
  try { const d = downloads || await claude.use("downloads"); await d.save({ filename: `call-${callNo}-transcript.md`, data }); }
  catch (e) { if (e?.code !== "declined") { try { await navigator.clipboard.writeText(data); note("保存不了文件，转写稿已复制。"); } catch { note("这里保存不了文件。"); } } }
}
const SAMPLE_PEOPLE = { en: { name: "Ruth", full: "Ruth Callaghan", family: "Helen" }, zh: { name: "秀兰", full: "林秀兰", family: "小敏" } };
function setLang(l) {
  for (const k of Object.keys(SAMPLE_PEOPLE[l])) if ($(k).value === SAMPLE_PEOPLE[lang][k]) $(k).value = SAMPLE_PEOPLE[l][k]; // 没改过的示例名字跟着语言换
  lang = l; $("lang-en").setAttribute("aria-pressed", l === "en"); $("lang-zh").setAttribute("aria-pressed", l === "zh"); refreshMemory(); describeVoice(); }

// 书：把文字排进固定大小的书页，再按跨页翻
const ZHT = t => /[\u3400-\u9fff]/.test(t);
const curly = t => t.replace(/(^|[\s(\[])"/g, "$1“").replace(/"/g, "”").replace(/(^|[\s(\[“])'/g, "$1‘").replace(/'/g, "’");
function blocks(md) {
  const out = [];
  for (const raw of md.split(/\n\s*\n/)) {
    const b = raw.trim();
    if (!b) continue;
    if (/^#{1,6}\s/.test(b)) { const m = b.match(/^(#{1,6})\s+(.+)$/s); out.push({ t: "h", text: m[2].trim() }); }
    else if (/^[-*_\s]{3,}$/.test(b)) out.push({ t: "gap" });
    else out.push({ t: "p", text: curly(b.replace(/\s+/g, " ").replace(/\*\*?([^*]+)\*\*?/g, "$1")) });
  }
  return out;
}
function fresh(cls = "", extra = "") {
  const s = document.createElement("div"); s.className = "sheet " + cls;
  s.innerHTML = `${extra}<div class="body"></div>`;
  $("measure").append(s);
  return s;
}
const NUM = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const who = b => b.name || b.author;
function paginate(ch, zh) {
  const pages = [], lh = parseFloat(getComputedStyle($("measure")).getPropertyValue("--lh")) || 0;
  let sheet = fresh("opener", `<div class="hd">${ch.label ? `<div class="num">${esc(ch.label)}</div>` : ""}<h2>${esc(curly(ch.title))}</h2></div>`);
  let body = sheet.querySelector(".body"), first = true;
  const over = () => body.scrollHeight > body.clientHeight + 1;
  const next = () => { pages.push(sheet.innerHTML); sheet.className = "sheet page-t"; sheet.innerHTML = '<div class="body"></div>'; body = sheet.querySelector(".body"); };
  const put = (el, t) => { // 开章前四个词用小型大写，量字时就算进去
    if (!el.dataset.lead) { el.textContent = t; return; }
    const w = t.split(/(?<=\s)/), k = Math.min(4, w.length);
    el.innerHTML = `<span class="sc">${esc(w.slice(0, k).join(""))}</span>${esc(w.slice(k).join(""))}`;
  };
  for (const b of blocks(ch.md)) {
    if (b.t === "gap") { const g = document.createElement("div"); g.className = "gap"; body.append(g); if (over()) { g.remove(); next(); } continue; }
    if (b.t === "h") { const h = document.createElement("h3"); h.textContent = b.text; body.append(h); if (over()) { h.remove(); next(); body.append(h); } continue; }
    const p = document.createElement("p"); if (first) { p.className = "first"; if (!zh) p.dataset.lead = "1"; } first = false;
    let text = b.text, cur = p;
    put(cur, text); body.append(cur);
    while (over()) {
      const cjk = ZHT(text), parts = cjk ? [...text] : text.split(/(?<=\s)/), tail = cjk ? 34 : 13; // 下一页至少留两行
      let lo = 0, hi = parts.length;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); put(cur, parts.slice(0, mid).join("")); over() ? hi = mid - 1 : lo = mid; }
      if (parts.length - lo < tail) { // 往回退一整行，断在行尾，不把最后一行撑开
        put(cur, parts.slice(0, lo).join("")); const h = cur.getBoundingClientRect().height;
        while (lo > 0) { lo--; put(cur, parts.slice(0, lo).join("")); if (cur.getBoundingClientRect().height < h) break; }
      }
      while (lo > 0 && /^[，。、；：？！）”’》]/.test(parts[lo] || "")) lo--; // 标点不放页首
      if (lo >= 4) { put(cur, parts.slice(0, lo).join("")); if (cur.getBoundingClientRect().height < parseFloat(getComputedStyle(cur).lineHeight) * 1.6) lo = 0; }
      const lead = cur.dataset.lead, cls = cur.className;
      if (lo < 4) { cur.remove(); lo = 0; } else cur.classList.add("cut");
      text = parts.slice(lo).join(""); next();
      cur = document.createElement("p"); cur.className = lo ? "cont" : cls; if (!lo && lead) cur.dataset.lead = lead;
      put(cur, text); body.append(cur);
    }
  }
  pages.push(sheet.innerHTML);
  sheet.remove();
  return pages.map((html, i) => ({ html, opener: i === 0, chapter: ch.title }));
}
function plate(id, zh) {
  if (id === "face") return '<img class="full" src="images/cover-face.jpg" alt="">';
  const c = PICTURES[id];
  return `<div class="pic"><img src="images/${id}.jpg" alt="${esc(c[1])}"><p class="cap">${esc(zh ? c[0] : c[1])}</p></div>`;
}
const REST = "";
function plateSVG() {
  let rim = "", dots = "";
  for (let i = 0; i < 40; i++) rim += `<path transform="rotate(${i * 9} 200 200)" d="M200 26 C210 40 210 52 200 66 C190 52 190 40 200 26 Z"/>`;
  for (let i = 0; i < 80; i++) dots += `<circle transform="rotate(${i * 4.5} 200 200)" cx="200" cy="78" r="1.7" fill="currentColor" stroke="none"/>`;
  return `<svg viewBox="0 0 400 400" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="200" cy="200" r="194"/><circle cx="200" cy="200" r="186" stroke-width=".7"/>${rim}<circle cx="200" cy="200" r="130"/><circle cx="200" cy="200" r="126" stroke-width=".7"/>${dots}</svg>`;
}
const COVERS = {
  evening: { name: "一幅画", say: "画里是她遇见 Bernie 的那条街。走文学精装的路子，不需要家庭照片。", long: "1930 年的 St Kilda 傍晚，Clarice Beckett 画的。书名压在天空里，作者名落在路上。", end: "#6f4436", spine: "#dfae94", ink: "#2a1914", credit: "Cover painting: Clarice Beckett, Evening, St Kilda Road, 1930." },
  face: { name: "她的脸", say: "乔布斯传的做法：一张脸，极少的字。用茶褐色代替黑白。", long: "人脸占满封面，名字放在最大的位置。这种做法最依赖家里有一张好照片。", end: "#4a2f20", spine: "#2a1c14", ink: "#f4e8d4", credit: "Cover photograph: unidentified woman, 1930s, State Library of New South Wales." },
  plate: { name: "那只盘子", say: "她母亲舍不得用的好盘子，书名就写在盘心。", long: "用一件真实的旧物当封面，这本是那只好盘子。每本书的物件都来自老人自己的故事。", end: "#1d332c", spine: "#1d332c", ink: "#eadfc6", credit: "Cover: plate, 1885–87, The Metropolitan Museum of Art, open access." },
  type: { name: "只有字", say: "Didion 那本的做法：字撑满书封，那个 I 是她自己。", long: "不用任何图，靠字距和比例撑住。没有照片的家庭也能用，你在页面上生成的书默认用它。", end: "#8a2f1b", spine: "#efe7d6", ink: "#1e1915", credit: "" },
};
function typeLines(book) {
  if (book === SAMPLE) return ["Peg", "Doyle", "Mostly", "I Turned", "Up"];
  const zh = book.zh, wrap = (text, max) => {
    if (zh) { const c = [...text.replace(/\s/g, "")], out = []; for (let i = 0; i < c.length; i += max) out.push(c.slice(i, i + max).join("")); return out; }
    const out = []; let cur = "";
    for (const w of text.split(/\s+/)) { if (cur && (cur + " " + w).length > max) { out.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; }
    if (cur) out.push(cur); return out;
  };
  return [...wrap(who(book), zh ? 4 : 9), ...wrap(curly(book.title), zh ? 5 : 9)].slice(0, 6);
}
function halves(title) { const w = curly(title).split(" "), k = Math.ceil(w.length / 2); return esc(w.slice(0, k).join(" ")) + "<br>" + esc(w.slice(k).join(" ")); }
function coverHTML(kind, book) {
  const A = esc(who(book));
  if (kind === "evening") return `<div class="cv cv-evening"><img class="art" src="images/cover-evening.jpg" alt=""><div class="c t">${halves(book.title)}</div><div class="c m">A memoir</div><div class="c a">${A}</div></div>`;
  if (kind === "face") return `<div class="cv cv-face"><img class="art" src="images/cover-face.jpg" alt=""><div class="c a">${A}</div><div class="c t">${esc(curly(book.title))}</div></div>`;
  if (kind === "plate") return `<div class="cv cv-plate"><div class="dish"></div><div class="c t">${halves(book.title)}</div><div class="c a">${A}</div></div>`;
  const lines = typeLines(book), max = Math.max(...lines.map(l => [...l].length)), size = Math.min(84, 448 / (max * (book.zh ? 1.04 : .6)));
  const row = l => `<div class="ln">${[...l].map(c => c === " " ? '<span class="w"></span>' : `<span${book === SAMPLE && l.startsWith("I ") && c === "I" ? ' class="hi"' : ""}>${esc(c)}</span>`).join("")}</div>`;
  return `<div class="cv cv-type ${book.zh ? "zh" : ""}" style="font-size:${size.toFixed(1)}px">${lines.map(row).join("")}</div>`;
}
function spineHTML(kind, book) {
  const c = COVERS[kind];
  return `<div class="spine" style="background:${c.spine};color:${c.ink}"><span>${esc(curly(book.title))}</span><i>${esc(who(book))}</i></div>`;
}
function backHTML(kind, book) {
  const c = COVERS[kind];
  return `<div class="bc" style="background-color:${c.spine};background-image:url(images/paper.jpg);color:${c.ink}">${book.backQuote ? `<q>${esc(curly(book.backQuote))}</q>` : ""}${book.blurb ? `<p>${esc(curly(book.blurb))}</p>` : ""}<div class="ed">${book.zh ? "家庭版 · 非卖品" : "A family edition · Not for sale"}</div></div>`;
}
let coverKind = "evening";
function fitCovers() {
  document.querySelectorAll(".bk3d").forEach(b => {
    const s = b.clientWidth / 540;
    b.querySelector(".sc-in").style.transform = b.querySelector(".spine-in").style.transform = `scale(${s})`;
    b.style.setProperty("--sp", 46 * s + "px");
  });
  const box = $("jacket-box"), s = box.clientWidth / 1126;
  box.style.height = 810 * s + "px"; $("jacket").style.transform = `scale(${s})`;
}
function showJacket() {
  const c = COVERS[coverKind];
  $("jacket-title").textContent = c.name;
  $("jacket-say").textContent = c.long;
  $("jacket").innerHTML = `<div class="jb">${backHTML(coverKind, SAMPLE)}</div><div class="js">${spineHTML(coverKind, SAMPLE)}</div><div class="jf">${coverHTML(coverKind, SAMPLE)}</div>`;
  document.querySelectorAll(".pick").forEach(b => b.setAttribute("aria-pressed", b.dataset.k === coverKind));
  fitCovers();
}
function renderCovers() {
  $("covers").innerHTML = Object.keys(COVERS).map(k => `<button class="pick" type="button" data-k="${k}"><div class="bk"><div class="bk3d"><div class="bk-spine"><div class="spine-in">${spineHTML(k, SAMPLE)}</div></div><div class="bk-front"><div class="sc-in">${coverHTML(k, SAMPLE)}</div></div></div></div><div><b>${COVERS[k].name}</b><span class="say">${COVERS[k].say}</span></div></button>`).join("");
  document.querySelectorAll(".pick").forEach(b => b.onclick = () => { coverKind = b.dataset.k; showJacket(); });
  showJacket();
}
addEventListener("resize", () => { if (!$("view-covers").hidden) fitCovers(); });
function assemble(book) {
  const zh = book.zh, pp = [], big = single(), kind = book === SAMPLE ? coverKind : "type", c = COVERS[kind], year = new Date().getFullYear();
  $("measure").className = "book" + (zh ? " zh" : "") + (big ? " big" : ""); // 量字要用和显示相同的字体
  $("measure").lang = zh ? "zh" : "en";
  const blank = () => pp.push({ html: REST, bare: true }), end = () => pp.push({ html: `<div class="endp" style="background-color:${c.end}"></div>`, bare: true, cls: "nog" });
  pp.push({ html: coverHTML(kind, book), bare: true, cls: "nog" });
  end(); end(); blank();
  pp.push({ html: `<div class="ht">${esc(curly(book.title))}</div>`, bare: true });
  pp.push({ html: book.frontis ? plate(book.frontis, zh) : "", bare: true });
  pp.push({ html: `<div class="tp"><div class="t">${esc(curly(book.title))}</div><div class="a">${esc(who(book))}</div><div class="p">${zh ? "家庭版" : "A family edition"}</div></div>`, bare: true });
  pp.push({ html: `<div class="cp"><p>${zh ? `${year} 年首版，家庭版` : `First family edition, ${year}`}<br>© ${year} ${esc(who(book))}</p><p>${esc(book.colophon)}</p>${book === SAMPLE && c.credit ? `<p>${esc(c.credit)}</p>` : ""}<p>${zh ? "正文字体 Noto Serif SC。" : "Set in EB Garamond and Libre Caslon."}</p></div>`, bare: true });
  pp.push({ html: book.dedication ? `<div class="dd">${book.dedication.split("\n").map(esc).join("<br>")}</div>` : "", bare: true });
  blank();
  const groups = [];
  book.chapters.forEach(ch => { const label = ch.unnumbered ? "" : (zh ? `第 ${ch.n} 章` : (NUM[ch.n] || String(ch.n))); groups.push({ ch: { ...ch, label }, pages: paginate({ ...ch, label }, zh) }); });
  pp.push({ html: `<div class="toc"><h2>${zh ? "目录" : "Contents"}</h2><div id="toc-slot"></div></div>`, bare: true, toc: true });
  let folio = 0;
  const tocRows = [];
  for (const g of groups) {
    if (g.ch.pic) pp.push({ html: plate(g.ch.pic, zh), bare: true }); // 配图紧接上一章，不留空白页
    else if (g === groups[0] && pp.length % 2 === 1) blank();
    g.start = pp.length;
    g.pages.forEach((p, i) => { folio++; if (i === 0) tocRows.push([g.ch.title, folio]); pp.push({ ...p, folio }); });
  }
  if (pp.length % 2 === 0) blank();
  end(); end();
  pp.push({ html: backHTML(kind, book), bare: true, cls: "nog" });
  const toc = pp.find(p => p.toc);
  toc.html = toc.html.replace('<div id="toc-slot"></div>', tocRows.map(r => `<div class="row"><span>${esc(curly(r[0]))}</span><span>${r[1]}</span></div>`).join(""));
  return { pp, groups, big };
}
let pendingChapter = null, bookSource = "sample", built = null, built_key = "", at = 0, turning = false;
function currentBook() {
  if (bookSource === "sample") return SAMPLE;
  const b = load("book"), name = $("name").value.trim(), zh = lang === "zh";
  const chapters = Object.keys(b).map(Number).sort((a, c) => a - c).map(n => ({ n, title: b[n].title, md: b[n].md, pic: b[n].pic }));
  return { title: zh ? `${name}的一生` : `The Life of ${name}`, author: zh ? `${name} 口述` : `As told by ${name}`, zh, name, frontis: "street", chapters,
    colophon: zh ? "这本书来自和 Annie 的电话。配图是公版老照片，只作示意，图中的人与讲述人无关。" : "Made from recorded calls with Annie. The pictures are public domain photographs, used for illustration; the people in them have no connection with the storyteller." };
}
function renderShelf() {
  const mine = Object.keys(load("book")).length;
  $("shelf").innerHTML = `<div class="lang"><button type="button" aria-pressed="${bookSource === "sample"}" id="pick-sample">样书</button>
    <button type="button" aria-pressed="${bookSource === "mine"}" id="pick-mine" ${mine ? "" : "disabled"}>${mine ? `你的书，${mine} 章` : "你的书还没开始"}</button></div>`;
  $("pick-sample").onclick = () => { bookSource = "sample"; openBook(); };
  $("pick-mine").onclick = () => { bookSource = "mine"; openBook(); };
}
function openBook() {
  const b = currentBook();
  renderShelf(); built = assemble(b); at = 0; renderSpread();
  if (pendingChapter) { jumpToChapter(pendingChapter); pendingChapter = null; }
}
function jumpToChapter(n) {
  const g = built.groups.find(x => x.ch.n === n);
  if (g) { at = single() ? g.start : g.start - 1; renderSpread(); }
}
const single = () => $("stage").clientWidth < 760;
function scaleFor() {
  const w = $("stage").clientWidth, h = Math.max(420, innerHeight - 290);
  return Math.min(w / (single() ? 540 : 1080), h / 810, 1.2);
}
function sheetHTML(p, i) {
  if (!p) return null;
  const s = document.createElement("div"), verso = !single() && i % 2 === 1;
  s.className = `sheet ${verso ? "verso" : "recto"}${p.opener ? " opener" : ""}${p.cls ? " " + p.cls : ""}`;
  const T = esc(curly(currentBook().title)), C = esc(curly(p.chapter || "")), F = `<span class="f">${p.folio}</span>`;
  const head = !p.bare && !p.opener ? `<div class="rh">${verso ? `${F}<span>${T}</span>` : `<span>${C}</span>${F}`}</div>` : "";
  s.innerHTML = head + p.html + (p.opener ? `<div class="foot">${p.folio}</div>` : "");
  return s;
}
function pairAt(i) { // 跨页的左右页下标。封面单独在右边
  if (single()) return [null, i];
  if (i <= 0) return [null, 0];
  const l = i % 2 ? i : i - 1; return [l, l + 1];
}
function renderSpread() {
  const stage = $("stage"), zh = currentBook().zh, s = scaleFor(), one = single();
  stage.innerHTML = ""; stage.className = "stage book" + (zh ? " zh" : "") + (built.big ? " big" : "") + (one ? " single" : ""); stage.lang = zh ? "zh" : "en";
  stage.style.height = 810 * s + "px";
  const [li, ri] = pairAt(at), wrap = document.createElement("div");
  wrap.className = "spread" + (one || li !== null ? "" : ""); wrap.style.transform = `translateX(${(!one && li === null ? -270 : !one && !built.pp[ri] ? 270 : 0) * s}px) scale(${s})`;
  wrap.style.position = "absolute"; wrap.style.left = "50%"; wrap.style.marginLeft = (one ? -270 : -540) + "px"; wrap.id = "spread";
  const add = (i, side) => {
    const slot = document.createElement("div"); slot.className = "slot " + side;
    const sh = i !== null && built.pp[i] ? sheetHTML(built.pp[i], i) : null;
    if (sh) { slot.classList.add("frame"); slot.append(sh); } else { const g = document.createElement("div"); g.className = "ghost"; slot.append(g); }
    wrap.append(slot);
  };
  if (!one) add(li, "left");
  add(ri, "right");
  stage.append(wrap);
  const prev = document.createElement("button"); prev.className = "hit l"; prev.type = "button"; prev.setAttribute("aria-label", "上一页"); prev.onclick = () => turn(-1);
  const next = document.createElement("button"); next.className = "hit r"; next.type = "button"; next.setAttribute("aria-label", "下一页"); next.onclick = () => turn(1);
  stage.append(prev, next);
  const last = built.pp.length - 1;
  $("prev").disabled = at <= 0; $("next").disabled = (one ? at : ri) >= last;
  const shown = built.pp.slice(0, (ri ?? 0) + 1).filter(p => p.folio).pop();
  $("at").textContent = at === 0 ? "封面" : shown ? `第 ${shown.folio} 页` : "";
}
function turn(dir) {
  if (turning) return;
  const [, ri] = pairAt(at), one = single(), last = built.pp.length - 1;
  const target = one ? at + dir : (dir > 0 ? (ri + 1) : Math.max(0, at - 2 + (at % 2 ? 0 : 0)));
  const to = one ? target : (dir > 0 ? ri + 1 : (at <= 2 ? 0 : pairAt(at)[0] - 2));
  if (to < 0 || to > last) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (one || still || at === 0 || to === 0) { at = to; renderSpread(); return; }
  turning = true;
  const wrap = $("spread"), [ol, or] = pairAt(at), [nl, nr] = pairAt(to);
  const face = i => { const d = document.createElement("div"); d.className = "side"; const s = i !== null && built.pp[i] ? sheetHTML(built.pp[i], i) : null; if (s) d.append(s); return d; };
  const leaf = document.createElement("div"); leaf.className = "leaf";
  const front = face(dir > 0 ? or : ol), back = face(dir > 0 ? nl : nr); back.classList.add("back");
  leaf.append(front, back);
  leaf.style.left = dir > 0 ? "50%" : "0"; leaf.style.transformOrigin = dir > 0 ? "left center" : "right center";
  // 翻页时底下露出新的一面
  const slots = wrap.querySelectorAll(".slot");
  const under = i => (i !== null && built.pp[i] ? sheetHTML(built.pp[i], i) : null);
  const target_slot = slots[dir > 0 ? 1 : 0], u = under(dir > 0 ? nr : nl);
  target_slot.innerHTML = ""; if (u) target_slot.append(u); else { const g = document.createElement("div"); g.className = "ghost"; target_slot.append(g); }
  wrap.append(leaf);
  leaf.animate([{ transform: "rotateY(0deg)" }, { transform: `rotateY(${dir > 0 ? -180 : 180}deg)` }], { duration: 620, easing: "cubic-bezier(.45,.05,.3,1)", fill: "forwards" }).onfinish = () => { turning = false; at = to; renderSpread(); };
}

// 规则页
const ANNIE = {"groups": [{"title": "确认身份", "rules": ["第一句只说自己是谁、找谁，不提书和家人。", "确认是本人后，轻轻问一句家人的核对问题。", "别人接电话，只请老人来听，不留内容。", "有人问什么事，只说是家人安排的私人电话。", "听说老人去世或住院，致歉后马上结束。", "语音信箱只留名字，说之后再打。"]}, {"title": "开场和同意", "rules": ["说明自己是 AI、谁安排的、在录音、随时能停。", "问现在方便吗，老人同意才继续。", "老人不愿意，立刻停止，不劝说。", "第 2 通起开场只说两句，像老朋友回来。"]}, {"title": "怎么说话", "rules": ["一次一两句，通常不超过 35 词，说完就停。", "一次只问一个问题，问题放最后。", "老人至少说四分之三的话。", "把对方当成年人，不用哄小孩的语气。", "不要每句都重复对方的话。"]}, {"title": "怎么听", "rules": ["先回应刚听到的具体内容，再问下一句。", "不总结对方说的话，不是每句都夸。", "不评价对方的性格和人生。", "不替对方说感受，不说“我理解”。", "老人停顿时等着，沉默常常是在回忆。"]}, {"title": "怎么追问", "rules": ["顺着“发生了什么、谁在场、什么感受、留下什么”往下走。", "不要像填履历一样一路往下问。", "碰到有生气的人或事，多停留两三轮。", "连续问了两个东西后，下一问转向人或感受。", "换话题要顺着老人刚说的话搭桥。", "一个故事追问三次左右就放下。"]}, {"title": "回答不到位时", "rules": ["老人永远不会答错，先接住，再换一扇门。", "太短就缩小到某一天或某个人。", "太笼统就请对方讲其中一次。", "记不清就说没关系，不要考试。", "前后矛盾不纠正。", "听错或不合语境，说线路不好，再问一次。"]}, {"title": "时间和结束", "rules": ["10 分钟开始留意收尾，14 分钟找停顿收尾。", "18 分钟必须开始收尾，20 分钟前说完再见。", "第 1 通 8 分钟开始收尾，15 分钟前结束。", "收尾分两轮：先点回一个细节并问能否留到下次，等回答再道别。", "不说时间到了，理由永远是这些内容值得慢慢听。", "老人累了或想停，马上温暖结束。"]}, {"title": "诚实和隐私", "rules": ["被问到就说自己是 AI，不编造经历。", "只用档案、brief 和这通说过的内容。", "不按名字猜性别。", "老人说“这个别写进书”，答应下来，不再提。", "Wren 的问题放在开场后问，不提 Wren。"]}, {"title": "安全", "rules": ["绝不要银行卡、密码、Medicare 号或钱。", "老人怀疑是诈骗，就说这很合理，请先和家人确认。", "不给医疗、法律和理财建议。", "老人难过时放慢，只陪一句，问要不要继续。", "老人回避的话题不再提。", "谈到自伤或危险，问是否安全，给 Lifeline 或 000。", "谈到被伤害，相信对方，给 1800 ELDERHelp。", "反复不知道这是什么电话，就温和结束。"]}], "calls": [[1, "认识你", "序章素材", "称呼、书写给谁、一个小故事、家庭情况"], [2, "老家和父母", "第 1 章 我从哪里来", "老家、父母各一个片段、最早的记忆"], [3, "长大", "第 2 章 长大", "学校、少年往事、第一次离家"], [4, "我的本事", "第 3 章 工作", "第一份工、最重要的工作场景、最自豪的事"], [5, "我爱的人", "第 4 章 我爱的人", "怎么认识、孩子出生、每个孩子一个印象"], [6, "难关", "第 5 章 难关", "老人自己选的一段难关，怎么过来的"], [7, "好时光", "第 6 章 好时光", "想起来会笑的事、朋友、时代大事"], [8, "想留下的话", "第 7 章和结尾", "最重要的身份、对具体的人说的话、书名"]]};
const WREN = {"steps": [{"when": "每通结束后", "title": "写 brief", "who": "agent", "what": "读完整转写稿，写给下一通的 Annie 看，不进书。", "rules": ["只记老人说过的，不猜。", "不超过 700 词。", "记下通话结果、不进书的内容和需要人工处理的情况。"]}, {"when": "每通结束后", "title": "第 1 步：提取", "who": "Wren", "what": "把这一通新增的事实记进总账。", "rules": ["每条都标来源，能查到第几通第几句。", "记下人物、时间线、故事、原话和口吻。", "Annie 说的话不算事实。"]}, {"when": "每通结束后", "title": "第 2 步：写章节", "who": "Wren", "what": "把完整转写稿写成这一章。", "rules": ["主要用这一通的转写稿，保留原话。", "篇幅跟着素材走，不凑字数。", "不重复前面章节讲过的故事。"]}, {"when": "每通结束后", "title": "第 3 步：列缺口", "who": "Wren", "what": "列出最多 3 个问题，交给下一通的 Annie。", "rules": ["优先补没讲完的故事，不问日期。", "用老人自己的话来问。", "不问老人拒绝过的内容。"]}, {"when": "8 通结束后", "title": "第 4 步：编全书", "who": "Wren", "what": "把各章编成一本书。", "rules": ["优先用老人自己起的书名。", "故事放回它发生的年份。", "序章从全部素材里挑一个场景。", "结尾放老人对具体的人说的话，几乎一字不改。"]}, {"when": "8 通结束后", "title": "第 5 步：核实", "who": "Wren", "what": "逐段对照转写稿，写核实报告。", "rules": ["列出没有依据的句子。", "检查不进书的内容和引语。", "列出可能伤害在世的人的内容。", "列出要确认的人名和地名。"]}, {"when": "第 9–11 周", "title": "人工审稿和老人确认", "who": "真人", "person": true, "what": "AI 写完不能直接印。", "rules": ["编辑读完全书和核实报告。", "老人有最终决定权。"]}, {"when": "第 11–12 周", "title": "排版和印刷", "who": "真人", "person": true, "what": "排成 A5 大字版 PDF，印刷后寄给客户。", "rules": ["先印一本样书核对。"]}], "groups": [{"title": "绝对不能做", "rules": ["不编造事实、日期、名字、感受或对话。", "不用历史常识补内容。", "老人说不进书的内容，一点暗示都不留。", "Annie 不出现在书里。", "只有老人说过的话才能放进引号。"]}, {"title": "保留老人的声音", "rules": ["用老人自己的词、节奏和幽默。", "去掉口语废话，但不过度润色。", "不把老人写得更聪明、更善良。", "口头禅要少用，几页出现一次就够。", "老人说什么语言，书就用什么语言。"]}, {"title": "怎么写一章", "rules": ["用故事搭起来，不写流水账。", "开头是一件事、一个人或一句话，不从“我出生”写起。", "人物靠做的事和说的话出场。", "结尾停在一样东西或老人的原话上，不讲道理。", "删掉老人对 Annie 说的话，比如“你的书”。"]}, {"title": "避免 AI 味", "rules": ["不用“不是……而是……”的翻转句。", "不用排比三连和工整的金句。", "不把不如意的事圆成好事。", "不用老人没用过的比喻。", "不用回忆录套话，比如“那时候真简单”。"]}]};
function renderRules() {
  $("view-annie").innerHTML = `<h1>Annie 的规则</h1><p class="lede">Annie 打电话、听故事。每条都是她在电话里要做到的事。</p>
    <div class="rules">${ANNIE.groups.map(g => `<section class="group"><h2>${g.title}</h2><ul>${g.rules.map(r => `<li>${r}</li>`).join("")}</ul></section>`).join("")}</div>
    <h2>8 通电话问什么</h2><div class="scroll"><table class="calls"><tr><th>通</th><th>主题</th><th>进书的哪一章</th><th>要带走什么</th></tr>${ANNIE.calls.map(c => `<tr><td>${c[0]}</td><td>${c[1]}</td><td>${c[2]}</td><td>${c[3]}</td></tr>`).join("")}</table></div>`;
  $("view-wren").innerHTML = `<h1>Wren 的规则</h1><p class="lede">Annie 聊完，完整的通话记录交给 Wren，写成书里的文字。</p>
    <ol class="flow">${WREN.steps.map(s => `<li><div class="when">${s.when}</div><div><h2>${s.title}<span class="who">${s.who}</span></h2><p>${s.what}</p><ul>${s.rules.map(r => `<li>${r}</li>`).join("")}</ul></div></li>`).join("")}</ol>
    <div class="rules">${WREN.groups.map(g => `<section class="group"><h2>${g.title}</h2><ul>${g.rules.map(r => `<li>${r}</li>`).join("")}</ul></section>`).join("")}</div>`;
}
// 电子版：每一幕只有一两句老人的原话，文字全部来自样书
const STOPS = ["Broken Hill", "Adelaide", "St Kilda", "Bendigo", "Now"];
const STORY = [
  { kind: "title", pic: "portrait", lines: ["Mostly I Turned Up", '<span class="kicker">Peg Doyle tells her life</span>'], stop: 0 },
  { kind: "paper", glyph: 1, lines: ["Mum kept a tin of good plates, for company.", "Company never came, mind you, but she kept them polished anyway."], stop: 0 },
  { pic: "home", lines: ["The front door’s the one nobody used.", "You came in the side, through the yard, past the tank stand and the wash house."], stop: 0 },
  { kind: "paper", lines: ["Red dust came under that door like it had somewhere to be."], stop: 0 },
  { pic: "school", alt: 1, lines: ["She looked at me a long while and said I had a head on me and shouldn’t waste it."], stop: 0 },
  { kind: "paper", lines: ["“You’ll not be stuck in this dust for the rest of your life,” Mum said."], stop: 0 },
  { pic: "puffing", lines: ["The old man pressed a ten-shilling note in my hand at the station.", "Dad never said much."], stop: 1 },
  { kind: "paper", lines: ["Lord, I was so green I could’ve been mistaken for a blade of grass."], stop: 1 },
  { pic: "wedding", alt: 1, lines: ["Then this big lump trod on my foot, looked at me like it was my fault, and said, “That’s me introduction.”", "Anyway, I married him, so it can’t have been that bad."], stop: 2 },
  { pic: "ward", lines: ["Sister Marge Pollard could read a labouring woman by her hands before you’d even seen her face.", "Took me years to get that."], stop: 3 },
  { pic: "street", alt: 1, lines: ["I told them I’d seen enough babies come into the world to know who was useful in there.", "Took them a while to vote, but they let the fathers in."], stop: 3 },
  { pic: "beach", lines: ["A day off was rare.", "I liked a slow morning with a walk to the bakery and the crossword."], stop: 4 },
  { kind: "paper", lines: ["A nurse, mostly.", "Mostly I turned up, that’s the bit I’d want put down."], stop: 4 },
  { kind: "paper", lines: ["Ella and Sam,", "Be useful. Nobody remembers the ones who weren’t.", "Mind you, you can remember I made a terrible cup of tea."], stop: 4 },
  { kind: "paper end", lines: ['<a href="#book">Read the whole book</a>'], stop: 4 },
];
let sceneAt = 0, filmTimer = null;
function buildFilm() {
  if ($("scenes").childElementCount) return;
  $("scenes").innerHTML = STORY.map(s => `<div class="scene ${s.kind || ""} ${s.alt ? "alt" : ""}">${s.pic ? `<img src="images/${s.pic}.jpg" alt=""><div class="veil"></div>` : ""}<div class="words">${s.glyph ? `<div class="glyph">${plateSVG()}</div>` : ""}${s.lines.map(l => `<p>${l}</p>`).join("")}</div></div>`).join("");
  $("life").innerHTML = '<div class="wire"></div><div class="bead" id="bead"></div>' + STOPS.map((n, i) => `<button type="button" data-i="${i}" style="left:${i / (STOPS.length - 1) * 100}%">${n}</button>`).join("");
  $("life").querySelectorAll("button").forEach(b => b.onclick = () => showScene(STORY.findIndex(s => s.stop === Number(b.dataset.i))));
}
function showScene(i) {
  sceneAt = Math.max(0, Math.min(STORY.length - 1, i));
  document.querySelectorAll(".scene").forEach((el, n) => el.classList.toggle("on", n === sceneAt));
  const s = STORY[sceneAt], inStop = STORY.filter(x => x.stop === s.stop), f = inStop.indexOf(s) / inStop.length;
  $("bead").style.left = Math.min(100, (s.stop + f) / (STOPS.length - 1) * 100) + "%";
  $("view-story").classList.toggle("light", !!(s.kind && s.kind.includes("paper")));
  $("life").querySelectorAll("button").forEach(b => b.classList.toggle("cur", Number(b.dataset.i) === s.stop));
  clearTimeout(filmTimer);
  if (filmPlaying && sceneAt < STORY.length - 1) filmTimer = setTimeout(() => showScene(sceneAt + 1), 3200 + s.lines.join("").length * 75 + (s.lines.length - 1) * 2100);
}
let filmPlaying = false;
function route() {
  const h = (location.hash || "#chat").slice(1), view = ["chat", "book", "covers", "annie", "wren", "story"].includes(h) ? h : "chat";
  for (const v of ["chat", "book", "covers", "annie", "wren", "story"]) $("view-" + v).hidden = v !== view;
  if (view === "story") { buildFilm(); requestAnimationFrame(() => showScene(0)); } else { clearTimeout(filmTimer); filmPlaying = false; $("film-play").textContent = "自动播放"; }
  if (view === "covers") renderCovers();
  document.querySelectorAll("nav a").forEach(a => a.getAttribute("href") === "#" + view ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  if (view === "book") document.fonts.ready.then(openBook);
}
for (let i = 1; i <= 8; i++) $("call").add(new Option(`第 ${i} 通：${ANNIE.calls[i - 1][1]}`, i));
$("start").onclick = start; $("form").onsubmit = send;
$("text").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("form").requestSubmit(); } };
$("skip").onclick = () => { skipped += 5; tick(); note("时钟快进了 5 分钟。"); };
$("hang").onclick = () => finish("你挂断了。");
$("mode-type").onclick = () => setVoice(false); $("mode-voice").onclick = () => setVoice(true);
$("mic").onclick = () => { if (micMode === "speaking") speech.cancel(); else if (micMode === "listening") commit(); else if (micMode === "idle") listen(); };
$("text").addEventListener("input", () => { if (ear.on) { stopEar(); setMic("idle"); showState("通话中"); } afterInput(); }); // 手动打字或系统听写时，让出输入框
$("text").addEventListener("keydown", () => { lastKey = Date.now(); });
$("voice-test").onclick = testVoice;
if ("speechSynthesis" in window) speechSynthesis.addEventListener?.("voiceschanged", describeVoice);
$("lang-en").onclick = () => setLang("en"); $("lang-zh").onclick = () => setLang("zh");
$("name").onchange = refreshMemory;
$("open-sample").onclick = () => { bookSource = "sample"; location.hash = "book"; };
$("prev").onclick = () => turn(-1); $("next").onclick = () => turn(1);
$("film-prev").onclick = () => showScene(sceneAt - 1); $("film-next").onclick = () => showScene(sceneAt + 1);
$("film-play").onclick = () => { filmPlaying = !filmPlaying; $("film-play").textContent = filmPlaying ? "暂停" : "自动播放"; showScene(sceneAt); };
addEventListener("keydown", e => { if (!$("view-story").hidden) { if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); showScene(sceneAt + 1); } if (e.key === "ArrowLeft") showScene(sceneAt - 1); if (e.key === "Escape") location.hash = "book"; } });
let filmX = null;
$("view-story").addEventListener("touchstart", e => { filmX = e.touches[0].clientX; }, { passive: true });
$("view-story").addEventListener("touchend", e => { if (filmX === null) return; const d = e.changedTouches[0].clientX - filmX; filmX = null; if (Math.abs(d) > 40) showScene(sceneAt + (d < 0 ? 1 : -1)); });
addEventListener("keydown", e => { if ($("view-book").hidden || /TEXTAREA|INPUT|SELECT/.test(e.target.tagName)) return; if (e.key === "ArrowRight") turn(1); if (e.key === "ArrowLeft") turn(-1); });
addEventListener("resize", () => { if (!$("view-book").hidden && built) { if (built.big !== single()) openBook(); else renderSpread(); } });
let touchX = null;
$("stage").addEventListener("touchstart", e => { touchX = e.touches[0].clientX; }, { passive: true });
$("stage").addEventListener("touchend", e => { if (touchX === null) return; const d = e.changedTouches[0].clientX - touchX; touchX = null; if (Math.abs(d) > 40) turn(d < 0 ? 1 : -1); });
addEventListener("hashchange", route);
renderRules(); route(); refreshMemory();
const exampleTurns = []; for (let i = 0; i < 26; i++) exampleTurns.push({ who: i % 2 ? "you" : "annie", text: "x".repeat(i % 2 ? 420 : 120) });
renderBill(billFor({ seconds: 720, phone: "mobile", system: P.core + P.calls[2], turns: exampleTurns, brief: "x".repeat(2600), transcript: "x".repeat(8000) }), { example: true, phone: "mobile", title: "话费单：12 分钟打手机" });
