const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, "uploads");
const DATA_DIR = path.join(ROOT, "data");
const LOG_FILE = path.join(DATA_DIR, "logs.json");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, "[]", "utf8");

app.use(express.json({ limit: "2mb" }));
// Frontend files are currently at the project root.
app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/app.js", (req, res) => res.sendFile(path.join(ROOT, "app.js")));
app.get("/style.css", (req, res) => res.sendFile(path.join(ROOT, "style.css")));
app.use("/uploads", express.static(UPLOAD_DIR));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 20 * 1024 * 1024, files: 100 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype);
    cb(ok ? null : new Error("画像ファイルのみアップロードできます"), ok);
  }
});

function readLogs() {
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeLogs(logs) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), "utf8");
}

function extFromMime(mime) {
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };
  return map[mime] || "";
}

function buildImageDataUrl(file) {
  const data = fs.readFileSync(file.path).toString("base64");
  return `data:${file.mimetype};base64,${data}`;
}

const extractionPrompt = `
あなたは「信長の野望 真戦」の戦闘スクリーンショットを整理するデータ抽出AIです。
画像に書いてある内容だけを使い、推測で数字や名前を補完しないでください。

目的は、後でダメージ計算式を研究するための実測データ作成です。
特に「誰が誰に何をして、何ダメージ与えたか」を重要視してください。

次のJSONだけを返してください。Markdownのコードブロックは禁止です。

{
  "game": "信長の野望 真戦",
  "battle_result": null,
  "turn": null,
  "screen_type": null,
  "units": [
    {
      "side": null,
      "name": null,
      "level": null,
      "troops_current": null,
      "troops_max": null,
      "speed": null,
      "kills": null,
      "rescue": null
    }
  ],
  "actions": [
    {
      "attacker": null,
      "target": null,
      "type": null,
      "skill": null,
      "damage": null,
      "damage_type": null,
      "troop_loss": null,
      "effect_text": null
    }
  ],
  "effects": [
    {
      "source": null,
      "target": null,
      "effect": null,
      "value": null,
      "duration": null
    }
  ],
  "visible_text": [],
  "uncertain_items": [],
  "confidence": 0
}

ルール:
- 読めない値は null。
- 画像内に複数の行動ログがあれば可能な限り全て抽出。
- 「通常攻撃」「戦法」「準備期間」などは type に入れる。
- ダメージの数字と「兵力○○損失」は区別する。明確に同一なら両方記録してよい。
- 「兵刃ダメージが47.20%増加」のような補正は effects に記録。
- visible_text は重要な日本語テキストを短く列挙。
- confidence は0〜1の数値。
`;

async function analyzeFile(filePath, mimeType) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY が設定されていません。RenderのEnvironment Variablesを確認してください。");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const dataUrl = buildImageDataUrl({ path: filePath, mimetype: mimeType });

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: extractionPrompt },
          { type: "input_image", image_url: dataUrl, detail: "high" }
        ]
      }
    ]
  });

  const text = (response.output_text || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("AIからJSON形式の結果を取得できませんでした");
  }
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    aiConfigured: !!process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-5.6-luna"
  });
});

app.get("/api/logs", (req, res) => {
  res.json(readLogs());
});

app.post("/api/upload", upload.array("images", 100), (req, res) => {
  const logs = readLogs();
  const battleId = (req.body.battleId || "").trim();
  const category = (req.body.category || "戦闘ログ").trim();
  const note = (req.body.note || "").trim();

  const created = (req.files || []).map(file => {
    const id = crypto.randomUUID();
    const ext = extFromMime(file.mimetype);
    const finalName = `${id}${ext}`;
    const finalPath = path.join(UPLOAD_DIR, finalName);
    fs.renameSync(file.path, finalPath);

    const record = {
      id,
      battleId,
      category,
      note,
      originalName: file.originalname,
      filename: finalName,
      mimetype: file.mimetype,
      uploadedAt: new Date().toISOString(),
      analysisStatus: "pending",
      analysis: null,
      analysisError: null
    };
    logs.push(record);
    return record;
  });

  writeLogs(logs);
  res.json({ ok: true, records: created });
});

app.post("/api/analyze/:id", async (req, res) => {
  const logs = readLogs();
  const record = logs.find(x => x.id === req.params.id);
  if (!record) return res.status(404).json({ error: "画像が見つかりません" });

  const filePath = path.join(UPLOAD_DIR, record.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "画像ファイルがサーバーにありません" });
  }

  record.analysisStatus = "processing";
  record.analysisError = null;
  writeLogs(logs);

  try {
    const analysis = await analyzeFile(filePath, record.mimetype);
    record.analysis = analysis;
    record.analysisStatus = "done";
    record.analyzedAt = new Date().toISOString();
    writeLogs(logs);
    res.json({ ok: true, record });
  } catch (err) {
    record.analysisStatus = "error";
    record.analysisError = err.message;
    writeLogs(logs);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/analyze-all", async (req, res) => {
  const logs = readLogs();
  const targets = logs.filter(x => x.analysisStatus === "pending" || x.analysisStatus === "error");

  res.json({ ok: true, queued: targets.length });

  // Sequential processing avoids sending a large number of image requests at once.
  (async () => {
    for (const record of targets) {
      try {
        const filePath = path.join(UPLOAD_DIR, record.filename);
        if (!fs.existsSync(filePath)) throw new Error("画像ファイルがありません");
        record.analysisStatus = "processing";
        writeLogs(logs);

        const analysis = await analyzeFile(filePath, record.mimetype);
        record.analysis = analysis;
        record.analysisStatus = "done";
        record.analyzedAt = new Date().toISOString();
        record.analysisError = null;
        writeLogs(logs);
      } catch (err) {
        record.analysisStatus = "error";
        record.analysisError = err.message;
        writeLogs(logs);
      }
    }
  })();
});

app.get("/api/export", (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="battle-data.json"');
  res.send(JSON.stringify(readLogs(), null, 2));
});

app.delete("/api/logs/:id", (req, res) => {
  const password = req.headers["x-admin-password"];
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: "管理者パスワードが違います" });
  }

  const logs = readLogs();
  const index = logs.findIndex(x => x.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "見つかりません" });

  const [record] = logs.splice(index, 1);
  const filePath = path.join(UPLOAD_DIR, record.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  writeLogs(logs);

  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || "エラーが発生しました" });
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
