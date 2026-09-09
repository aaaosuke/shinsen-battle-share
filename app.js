const $ = (s) => document.querySelector(s);

let records = [];

async function load() {
  const gallery = $("#gallery");
  try {
    const r = await fetch("/api/logs");
    if (!r.ok) throw new Error(await r.text());
    records = await r.json();
    render();
  } catch (e) {
    gallery.innerHTML = `<p>取得できません: ${escapeHtml(e.message)}</p>`;
  }
}

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusLabel(status) {
  return ({
    pending: "未解析",
    processing: "解析中",
    done: "解析済み",
    error: "解析エラー"
  })[status] || status;
}

function render() {
  const gallery = $("#gallery");
  const done = records.filter(x => x.analysisStatus === "done").length;
  const pending = records.filter(x => x.analysisStatus === "pending").length;
  const errors = records.filter(x => x.analysisStatus === "error").length;

  $("#summary").innerHTML =
    `<div class="summary">画像 ${records.length}枚 / 解析済み ${done} / 未解析 ${pending} / エラー ${errors}</div>`;

  gallery.innerHTML = "";

  [...records].reverse().forEach(record => {
    const node = document.importNode($("#recordTemplate").content, true);
    node.querySelector(".thumb").src = `/uploads/${encodeURIComponent(record.filename)}`;
    node.querySelector(".thumb").alt = record.originalName;
    node.querySelector(".name").textContent = record.originalName;
    node.querySelector(".meta").textContent =
      `${record.battleId || "戦闘IDなし"} / ${record.category} / ${new Date(record.uploadedAt).toLocaleString()}`;
    node.querySelector(".badge").textContent = statusLabel(record.analysisStatus);

    const analysis = node.querySelector(".analysis");
    if (record.analysisStatus === "done") {
      analysis.textContent = JSON.stringify(record.analysis, null, 2);
    } else if (record.analysisStatus === "error") {
      analysis.textContent = `エラー: ${record.analysisError || "不明"}`;
    } else if (record.analysisStatus === "processing") {
      analysis.textContent = "AI解析中…";
    } else {
      analysis.textContent = "まだAI解析していません。";
    }

    node.querySelector(".analyze").addEventListener("click", () => analyze(record.id));
    node.querySelector(".delete").addEventListener("click", () => removeRecord(record.id));
    gallery.appendChild(node);
  });
}

async function analyze(id) {
  $("#aiStatus").textContent = "AI解析中…";
  try {
    const r = await fetch(`/api/analyze/${encodeURIComponent(id)}`, { method: "POST" });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "解析に失敗しました");
    $("#aiStatus").textContent = "解析完了";
    await load();
  } catch (e) {
    $("#aiStatus").textContent = `解析エラー: ${e.message}`;
    await load();
  }
}

$("#uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const status = $("#uploadStatus");
  status.textContent = "アップロード中…";

  try {
    const r = await fetch("/api/upload", { method: "POST", body: new FormData(form) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "アップロードに失敗しました");
    status.textContent = `${data.records.length}枚アップロードしました`;
    form.reset();
    await load();
  } catch (e) {
    status.textContent = `エラー: ${e.message}`;
  }
});

$("#analyzeAll").addEventListener("click", async () => {
  $("#aiStatus").textContent = "未解析画像の処理を開始しました。画面を更新しながら進みます。";
  try {
    const r = await fetch("/api/analyze-all", { method: "POST" });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "開始できませんでした");
    $("#aiStatus").textContent = `${data.queued}枚の解析を開始しました。`;
    poll();
  } catch (e) {
    $("#aiStatus").textContent = `エラー: ${e.message}`;
  }
});

async function poll() {
  await load();
  if (records.some(x => x.analysisStatus === "processing")) {
    setTimeout(poll, 2500);
  }
}

async function removeRecord(id) {
  const password = prompt("管理者パスワードを入力してください");
  if (password === null) return;

  const r = await fetch(`/api/logs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "x-admin-password": password }
  });
  const data = await r.json();
  if (!r.ok) return alert(data.error || "削除できませんでした");
  await load();
}

$("#refresh").addEventListener("click", load);

load();
