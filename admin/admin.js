// 后台页面。通话内容是测试的人说的，这里只用 textContent 写进页面，不拼 HTML。
const RELAY = document.querySelector('meta[name="relay"]').content;
const STORE = "memoir-admin";
const $ = id => document.getElementById(id);
let key = "", state = null, picked = null;

function el(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids.filter(k => k !== null && k !== undefined).map(k => (k instanceof Node ? k : String(k))));
  return node;
}
async function api(path, body) {
  const res = await fetch(`${RELAY}/admin/api/${path}`, { method: body ? "POST" : "GET", headers: { "x-admin-key": key, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) throw new Error("password");
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "failed");
  return data;
}
const usd = n => `$${Number(n || 0).toFixed(n >= 1 ? 2 : 4)}`;
const span = s => { const m = Math.floor(s / 60); return m < 60 ? `${m} 分 ${s % 60} 秒` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`; };
const when = t => (t ? new Date(t).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" }) : "没有");
const count = n => Number(n || 0).toLocaleString("en-AU");
const MODELS = { claude: "Claude", gpt: "GPT" };
const models = s => (s || "").split(",").filter(Boolean).map(p => MODELS[p] || p).join("、") || "未知";
const label = a => a.username || `码 ${a.code.slice(0, 5)}`;

function statusOf(a) {
  if (a.stopped) return "已停用";
  if (a.expires < Date.now()) return "已过期";
  return `到 ${when(a.expires)}`;
}
function renderTotals() {
  const sum = key => state.accounts.reduce((n, a) => n + (a[key] || 0), 0);
  const stat = (value, name) => el("div", {}, el("div", { className: "num" }, value), el("div", { className: "soft" }, name));
  $("totals").replaceChildren(stat(state.accounts.filter(a => a.username).length, "个账户"), stat(usd(sum("spent")), "总花费"), stat(sum("calls"), "通电话"), stat(span(sum("seconds")), "总时长"));
}
function renderAccounts() {
  $("accounts").replaceChildren(...state.accounts.map(a => {
    const row = el("tr", { className: "pick", tabIndex: 0 },
      el("td", {}, label(a)), el("td", { className: "wide" }, a.note), el("td", {}, `${usd(a.spent)} / $${a.limit_usd}`), el("td", {}, a.calls), el("td", {}, span(a.seconds)), el("td", {}, when(a.last_used)));
    row.setAttribute("aria-selected", a.code === picked);
    row.onclick = () => { picked = a.code; render(); $("detail").scrollIntoView({ behavior: "smooth", block: "start" }); };
    row.onkeydown = e => { if (e.key === "Enter") row.click(); };
    return row;
  }));
}
function plain(r, usage) {
  const lines = (r.turns || []).map(t => `${t.who === "annie" ? "Annie" : "讲述人"}：${t.text}`);
  return [`${r.name}，第 ${r.call} 通，${r.ended || ""}`, ...lines, "下一通笔记", r.sheet || "无", "这一章", r.chapter || "无", "还想问的", r.gaps || "无",
    "每次请求", ...usage.map(u => `${when(u.at)} ${u.model} 输入 ${u.input} 缓存 ${u.cached} 输出 ${u.output} ${usd(u.usd)}`)].join("\n\n");
}
function callBody(box, c, data) {
  const { record: r, usage } = data;
  const part = (title, text) => (text ? [el("h3", {}, title), el("p", { className: "text" }, text)] : []);
  const head = el("tr", {}, ...["时间", "模型", "输入", "缓存", "输出", "花费"].map(t => el("th", {}, t)));
  const rows = usage.map(u => el("tr", {}, ...[when(u.at), u.model, count(u.input), count(u.cached), count(u.output), usd(u.usd)].map(t => el("td", {}, t))));
  const save = el("button", { className: "btn quiet", type: "button", textContent: "下载" });
  save.onclick = () => {
    const a = el("a", { href: URL.createObjectURL(new Blob([plain(r, usage)], { type: "text/plain" })), download: `call-${c.id}.txt` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const drop = el("button", { className: "btn quiet", type: "button", textContent: "删除这一通" });
  drop.onclick = async () => { if (confirm("永久删除这一通的原话？花费记录会留下，删了找不回来。")) { await api("delete", { code: c.code, id: c.id }); await refresh(); } };
  box.replaceChildren(
    el("p", { className: "soft" }, `讲述人 ${r.full || r.name}，安排的家人 ${r.family || "无"}，语言 ${r.lang === "zh" ? "中文" : "英文"}。${r.ended || ""}`),
    el("h3", {}, "原话"), ...(r.turns || []).map(t => el("p", { className: "line" }, el("b", {}, t.who === "annie" ? "Annie" : "讲述人"), t.text)),
    ...part("下一通笔记", r.sheet), ...part("这一章", r.chapter), ...part("还想问的", r.gaps),
    el("h3", {}, "每次请求"), el("div", { className: "scroll" }, el("table", {}, el("thead", {}, head), el("tbody", {}, ...rows))),
    el("div", { className: "tools" }, save, drop));
}
function callRow(c) {
  const box = el("div", { className: "body" }, "正在读取…");
  const item = el("details", { className: "call" },
    el("summary", {}, el("span", {}, when(c.updated)), el("span", {}, `第 ${c.call_no} 通 · ${c.name}`), el("span", {}, models(c.providers)), el("span", {}, span(c.seconds)), el("span", {}, usd(c.usd))), box);
  let loaded = false;
  item.ontoggle = async () => {
    if (!item.open || loaded) return;
    loaded = true;
    try { callBody(box, c, await api("call", { code: c.code, id: c.id })); } catch { loaded = false; box.textContent = "读取失败，再打开一次试试。"; }
  };
  return item;
}
function renderDetail() {
  const a = state.accounts.find(x => x.code === picked);
  $("detail").hidden = !a;
  if (!a) return;
  const calls = state.calls.filter(c => c.code === a.code);
  const reset = el("button", { className: "btn", type: "button", textContent: "重置密码" }), more = el("button", { className: "btn", type: "button", textContent: "改额度" });
  const stop = el("button", { className: "btn quiet", type: "button", textContent: a.stopped ? "恢复使用" : "停用" });
  reset.hidden = !a.username;
  reset.onclick = async () => {
    if (!confirm(`给 ${a.username} 生成新密码？旧密码马上失效。`)) return;
    showPassword(await api("reset", { code: a.code }));
    $("made").scrollIntoView({ behavior: "smooth", block: "center" });
  };
  more.onclick = async () => {
    const limit = prompt(`把 ${label(a)} 的额度改成多少美元？`, a.limit_usd);
    if (limit === null) return;
    try { await api("limit", { code: a.code, limit }); await refresh(); } catch { alert("额度要在 0 到 100 之间。"); }
  };
  stop.onclick = async () => { if (confirm(a.stopped ? `恢复 ${label(a)}？` : `停用 ${label(a)}？`)) { await api("stop", { code: a.code, stopped: !a.stopped }); await refresh(); } };
  $("detail").replaceChildren(
    el("h2", {}, label(a) + (a.note ? `：${a.note}` : "")),
    el("div", { className: "sheet" },
      el("div", { className: "totals" },
        el("div", {}, el("div", { className: "num" }, usd(a.spent)), el("div", { className: "soft" }, `额度 $${a.limit_usd}，还剩 ${usd(Math.max(a.limit_usd - a.spent, 0))}`)),
        el("div", {}, el("div", { className: "num" }, usd(a.claude_usd)), el("div", { className: "soft" }, "Claude")),
        el("div", {}, el("div", { className: "num" }, usd(a.gpt_usd)), el("div", { className: "soft" }, "GPT"))),
      el("div", { className: "facts" },
        el("span", {}, `${a.calls} 通，${span(a.seconds)}`), el("span", {}, `${count(a.requests)} 次请求`), el("span", {}, `输入 ${count(a.input)} token`), el("span", {}, `输出 ${count(a.output)} token`),
        el("span", {}, `最近登录 ${when(a.last_login)}`), el("span", {}, statusOf(a))),
      el("div", { className: "tools" }, reset, more, stop)),
    el("h3", {}, "通话"),
    calls.length ? el("div", {}, ...calls.map(callRow)) : el("p", { className: "soft" }, "还没有通话。"));
}
function render() { renderTotals(); renderAccounts(); renderDetail(); }
async function refresh() { state = await api("state"); render(); }

function showPassword({ username, password }) {
  const copy = el("button", { className: "btn", type: "button", textContent: "复制账户和密码" });
  copy.onclick = async () => { try { await navigator.clipboard.writeText(`账户：${username}\n密码：${password}`); copy.textContent = "已复制"; } catch { copy.textContent = "复制不了，请手动选中"; } };
  $("made").hidden = false;
  $("made").replaceChildren(el("p", { className: "bad" }, "密码只显示这一次，现在发给对方。"), el("p", { className: "pair" }, `账户 ${username}`), el("p", { className: "pair" }, `密码 ${password}`), el("div", { className: "tools" }, copy));
}
async function enter(value) {
  key = value;
  await refresh();
  try { sessionStorage.setItem(STORE, key); } catch {}
  $("gate").hidden = true; $("main").hidden = false; $("out").hidden = false;
}
$("gate").onsubmit = async e => {
  e.preventDefault();
  $("gate-note").textContent = "";
  try { await enter($("key").value); $("key").value = ""; }
  catch (err) { $("gate-note").textContent = err.message === "password" ? "密码不对。" : "连不上服务，稍后再试。"; }
};
$("out").onclick = () => { try { sessionStorage.removeItem(STORE); } catch {} location.reload(); };
const WHY = { bad_username: "账户名用 2 到 32 位的字母、数字、点、横线或下划线。", bad_limits: "额度要在 0 到 100 之间，天数要在 1 到 365 之间。", taken: "这个账户名已经有了。" };
$("make").onsubmit = async e => {
  e.preventDefault();
  $("make-note").textContent = "";
  try {
    const made = await api("accounts", { username: $("username").value, note: $("note").value, limit: $("limit").value, days: $("days").value });
    showPassword(made);
    $("username").value = ""; $("note").value = "";
    await refresh();
  } catch (err) { $("make-note").textContent = WHY[err.message] || "没有建成，再试一次。"; }
};
try { const saved = sessionStorage.getItem(STORE); if (saved) enter(saved).catch(() => sessionStorage.removeItem(STORE)); } catch {}
