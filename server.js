const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const HOST = "https://api.h5.helloaba.cn/";
const PUBLIC_DIR = path.join(__dirname, "public");
const SHAMPOO =
  "rytujfghjd#$%^$%^*#^2345thdghdfgWERTSFS356E6Ysssfgsyw5$&^*#%^^@%$TFgsfyew5yq465467456SFGDHERTYERTY#%$6yhdgh";
const TARGET_TAGS = ["推理", "还原"];

function sortedParamString(data) {
  return Object.keys(data)
    .sort()
    .map((key) => {
      const value = Array.isArray(data[key])
        ? "dfghdfgprt87089bxcvsdf245TTY~!#$%ASDFSFA14793347TYRTthdgh!@$$fgdfghdfgj3^&hdfgsF&"
        : data[key];
      return `${key}=${value}`;
    })
    .join("&");
}

function extractScriptId(input) {
  const value = String(input || "").trim();
  if (/^\d{12,}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.searchParams.get("id")) return url.searchParams.get("id");
    const page = decodeURIComponent(url.searchParams.get("PAGE") || "");
    const match = /scriptId=(\d+)/.exec(page);
    if (match) return match[1];
  } catch {
    const match = /(?:scriptId%3D|scriptId=|id=)(\d{12,})/.exec(value);
    if (match) return match[1];
  }
  return null;
}

function normalizeName(value) {
  return String(value || "")
    .replace(/[《》<>「」『』\s:：·・,，.。!！?？\-_/\\()[\]（）【】]/g, "")
    .toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function itemTags(item) {
  return String(item.scriptTag || "")
    .split("@")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function isTargetScriptItem(item) {
  return itemTags(item).some((tag) => TARGET_TAGS.includes(tag));
}

function sourceCategoryFromTags(tags, fallback = "谜圈-剧本库") {
  if ((tags || []).includes("推理")) return "谜圈-剧本库-推理";
  if ((tags || []).includes("还原")) return "谜圈-剧本库-还原";
  return fallback;
}

function sourceCategoryFromLabelType(labelType, item) {
  if (Number(labelType) === 2) return "谜圈-剧本库-推理";
  if (Number(labelType) === 4) return "谜圈-剧本库-还原";
  return sourceCategoryFromTags(itemTags(item));
}

function decodeHarPostData(entry) {
  try {
    const text = entry.request?.postData?.text;
    if (!text) return {};
    const body = JSON.parse(text);
    if (!body.data) return body;
    return JSON.parse(Buffer.from(body.data, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

function dedupeScriptItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const scriptId = String(item.scriptId || "");
    if (!scriptId || seen.has(scriptId)) continue;
    seen.add(scriptId);
    out.push({ ...item, scriptId });
  }
  return out;
}

async function postMiquan(pathname, data) {
  const nonce = String(Math.random());
  const checkSum = crypto
    .createHash("md5")
    .update(nonce + sortedParamString(data) + SHAMPOO)
    .digest("hex");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(HOST + pathname, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        version: "1.0.0",
        userToken: "",
        appHeader: "{}",
        nonce,
        checkSum,
        clientType: "1",
        clientVersion: "3.0.0",
        curTime: String(Date.now()),
        mobileType: "0",
        referer: "https://m.helloaa.cn/",
        origin: "https://m.helloaa.cn",
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchReasoningRankItems() {
  const subRanks = [
    { type: 1, name: "推理人气榜", sourceCategory: "谜圈-推理人气榜" },
    { type: 2, name: "推理口碑榜", sourceCategory: "谜圈-推理口碑榜" },
  ];
  const pages = await Promise.allSettled(
    subRanks.map((rank) =>
      postMiquan("rank/getSubRankTabSingleRankDetail", {
        rankTabType: "23",
        subRankTabType: rank.type,
        pageNum: 1,
        pageSize: 50,
      }),
    ),
  );
  const items = pages.flatMap((page, index) => {
    if (page.status !== "fulfilled" || page.value.head?.code !== 200) return [];
    return (page.value.data?.items || []).map((item) => ({
      ...item,
      sourceName: subRanks[index].name,
      sourceCategory: subRanks[index].sourceCategory,
    }));
  });
  if (!items.length) {
    throw new Error("推理榜接口返回异常");
  }
  return dedupeScriptItems(items.filter(isTargetScriptItem));
}

function fetchHarLibraryItems() {
  const workDir = path.join(__dirname, "work");
  if (!fs.existsSync(workDir)) return [];
  const harPaths = fs
    .readdirSync(workDir)
    .filter((file) => file.toLowerCase().endsWith(".har"))
    .map((file) => path.join(workDir, file));
  if (!harPaths.length) return [];

  const items = [];
  const pages = new Map();
  for (const harPath of harPaths) {
    try {
      const har = JSON.parse(fs.readFileSync(harPath, "utf8"));
      for (const entry of har.log?.entries || []) {
        const requestUrl = entry.request?.url || "";
        if (!requestUrl.includes("/v9/script/scriptSearchPage")) continue;
        const requestData = decodeHarPostData(entry);
        const text = entry.response?.content?.text;
        if (!text) continue;
        const payload = JSON.parse(text);
        const pageItems = payload.data?.items || [];
        const pageKey = pageItems.map((item) => item.scriptId).join(",");
        if (pageKey && pages.has(pageKey)) continue;
        if (pageKey) pages.set(pageKey, true);
        for (const item of pageItems) {
          const sourceCategory = sourceCategoryFromLabelType(requestData.scriptLabelType, item);
          items.push({
            ...item,
            sourceName: "剧本库抓包样本",
            sourceCategory,
            sourceHarFile: path.basename(harPath),
          });
        }
      }
    } catch {
      continue;
    }
  }

  return dedupeScriptItems(items.filter(isTargetScriptItem));
}

function normalizeHarLibraryItem(item) {
  const tags = itemTags(item);
  const rawScore =
    item.scriptScore ?? item.recommendNum ?? item.score ?? item.scriptRecommendScore ?? item.scriptGrade;
  const numericScore = Number(rawScore);
  const score = Number.isFinite(numericScore) ? (numericScore > 10 ? numericScore / 10 : numericScore) : null;
  const playerLimit = item.scriptPlayerLimit ?? item.playerLimit ?? item.people;
  const maleLimit = item.scriptMalePlayerLimit ?? item.maleLimit;
  const femaleLimit = item.scriptFemalePlayerLimit ?? item.femaleLimit;
  const itemScriptId = String(item.scriptId || "");

  // Apply fixed score from cache if available
  let finalScore = score;
  let finalQuality = "unverified";
  let finalCommentCount = item.scriptScoreCount ?? item.evaluateCount ?? item.commentCount;
  let finalPlayedCount = item.scriptPlayedCount ?? item.playedCount;
  let finalWantCount = item.scriptWantPlayerCount ?? item.wantPlayCount ?? item.wantCount;
  let finalFetchedAt = new Date().toISOString();

  const fixed = loadFixedCache();
  if (fixed[itemScriptId]) {
    finalScore = fixed[itemScriptId].score;
    finalQuality = "api-verified";
    finalCommentCount = fixed[itemScriptId].commentCount || finalCommentCount;
    finalPlayedCount = fixed[itemScriptId].playedCount || finalPlayedCount;
    finalWantCount = fixed[itemScriptId].wantCount || finalWantCount;
    finalFetchedAt = fixed[itemScriptId].fetchedAt || finalFetchedAt;
  }

  return {
    input: item.sourceHarFile || "HAR",
    fetchedAt: finalFetchedAt,
    scriptId: itemScriptId,
    scriptName: String(item.scriptName || "").trim(),
    score: finalScore,
    scores: {},
    wantCount: finalWantCount,
    playedCount: finalPlayedCount,
    commentCount: finalCommentCount,
    totalEvaluateNum: item.scriptScoreCount ?? item.evaluateCount ?? item.commentCount,
    fetchedCommentCount: 0,
    commentSampleMode: finalQuality === "api-verified" ? "服务端缓存修正，已更新真实评分" : "抓包快速入库，尚未补评价样本",
    commentStats: { total: 0 },
    tags,
    tagText: tags.join(" / "),
    durationMinutes: item.groupDuration ?? item.durationMinutes,
    durationHours: item.groupDuration ? Math.round((item.groupDuration / 60) * 10) / 10 : item.durationHours,
    maleLimit,
    femaleLimit,
    people: [maleLimit, femaleLimit].every((n) => n != null)
      ? `${maleLimit}男${femaleLimit}女`
      : playerLimit
        ? `${playerLimit}人`
        : "",
    publishTime: item.scriptIssueUnitTime
      ? new Date(Number(item.scriptIssueUnitTime)).toISOString().slice(0, 10)
      : item.publishTime || "",
    authorName: item.authorName || item.scriptAuthorName || "",
    publisherName: item.publisherName || item.issueName || item.scriptIssueUnitName || "",
    difficulty: item.scriptDifficultyDegreeName || item.difficulty || "",
    intro: item.scriptIntro || item.scriptTextContent || "",
    coverUrl: item.scriptCoverUrl || item.coverUrl || "",
    rawDetail: item,
    comments: [],
    dataQuality: finalQuality,
    resolvedFrom: finalQuality === "api-verified"
      ? `${item.sourceName || "剧本库抓包样本"}导入 + 服务端修正：${item.scriptName || item.scriptId}`
      : `${item.sourceName || "剧本库抓包样本"}导入：${item.scriptName || item.scriptId}`,
    sourceCategory: item.sourceCategory || sourceCategoryFromTags(tags),
    shareUrl: `https://m.helloaa.cn/pages/share/newScriptDetail/newScriptDetail?PAGE=trendplay%3A%2F%2FscriptDetail%3FscriptId%3D${item.scriptId}&id=${item.scriptId}&channelCode=100&channelId=6&inviteUniqueId=VacMKx4q&lp=1`,
  };
}

// Fixed score cache
function loadFixedCache() {
  if (!fs.existsSync(MIQUAN_FIXED_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(MIQUAN_FIXED_PATH, "utf8"));
  } catch { return {}; }
}

async function fetchGoodScriptItems(typeIds = ["1"]) {
  const allItems = [];
  for (const typeId of typeIds) {
    const first = await postMiquan("goodScript/getGoodScriptByScriptType", {
      goodScriptTypeId: typeId,
      userLongitude: "",
      userLatitude: "",
      cityCode: "440300",
      pageNum: 1,
      pageSize: 50,
    });
    if (first.head?.code !== 200) continue;
    const pages = Math.max(1, Number(first.data?.pages || 1));
    allItems.push(
      ...(first.data?.items || []).map((item) => ({
        ...item,
        sourceName: typeId === "1" ? "硬核推理好本" : `好本分类${typeId}`,
        sourceCategory: typeId === "1" ? "谜圈-硬核推理好本" : `谜圈-好本分类${typeId}`,
      })),
    );
    for (let pageNum = 2; pageNum <= pages; pageNum += 1) {
      await sleep(120);
      const page = await postMiquan("goodScript/getGoodScriptByScriptType", {
        goodScriptTypeId: typeId,
        userLongitude: "",
        userLatitude: "",
        cityCode: "440300",
        pageNum,
        pageSize: 50,
      });
      if (page.head?.code !== 200) break;
      allItems.push(
        ...(page.data?.items || []).map((item) => ({
          ...item,
          sourceName: typeId === "1" ? "硬核推理好本" : `好本分类${typeId}`,
          sourceCategory: typeId === "1" ? "谜圈-硬核推理好本" : `谜圈-好本分类${typeId}`,
        })),
      );
    }
  }
  return dedupeScriptItems(allItems);
}

async function fetchTopHundredScriptItems() {
  const out = await postMiquan("top/hundred/geTopHundredScriptList", {
    pageNum: 1,
    pageSize: 100,
  });
  if (out.head?.code !== 200) return [];
  return dedupeScriptItems(
    (out.data?.items || []).map((item) => ({
      ...item,
      sourceName: "谜圈百大剧本",
      sourceCategory: "谜圈-百大剧本",
    })),
  );
}

async function fetchPublicCandidateItems({ includeTop100 = true } = {}) {
  const [rank, good, top100, harItems] = await Promise.allSettled([
    fetchReasoningRankItems(),
    fetchGoodScriptItems(["1"]),
    includeTop100 ? fetchTopHundredScriptItems() : Promise.resolve([]),
    Promise.resolve(fetchHarLibraryItems()),
  ]);
  return dedupeScriptItems(
    [rank, good, top100, harItems].flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
  );
}

function findCandidateByName(candidates, input) {
  const query = normalizeName(input);
  const exact = candidates.find((item) => normalizeName(item.scriptName) === query);
  return (
    exact ||
    candidates.find((item) => normalizeName(item.scriptName).includes(query)) ||
    candidates.find((item) => query.includes(normalizeName(item.scriptName)))
  );
}

async function resolveInputToScriptId(input) {
  const scriptId = extractScriptId(input);
  if (scriptId) return { scriptId, resolvedFrom: "链接/id" };

  const query = normalizeName(input);
  if (!query) throw new Error("没有识别到剧本名、scriptId 或分享链接。");

  const candidates = await fetchPublicCandidateItems();
  const fuzzy = findCandidateByName(candidates, input);

  if (!fuzzy) {
    throw new Error(`公开来源里没有找到「${input}」。可以粘贴分享链接，或先从谜圈分享一次该本。`);
  }

  return {
    scriptId: fuzzy.scriptId,
    resolvedFrom: `${fuzzy.sourceName || "公开来源"}匹配：${fuzzy.scriptName}`,
    rankItem: fuzzy,
    sourceCategory: fuzzy.sourceCategory,
  };
}

function scoreMap(names = [], scores = []) {
  return Object.fromEntries(names.map((name, index) => [name, scores[index]]));
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function normalizeComment(item, sourceLabel) {
  const degreeValue = item.recommendDegree;
  const text = item.evaluateTextContent || "";
  return {
    id: item.scriptEvaluateId || item.evaluateId || crypto.createHash("md5").update(`${item.nickName || ""}:${text}`).digest("hex"),
    nickName: item.anonymousStatus ? "匿名" : item.nickName,
    recommendDegree:
      ["", "推荐", "一般", "极差"][degreeValue] || (degreeValue ? String(degreeValue) : "随机"),
    scores: scoreMap(item.scriptLabelNames || [], item.scriptLabelScores || []),
    text,
    sourceLabel,
    createTime: item.createTime || "",
  };
}

function mixComments(commentGroups, randomItems, targetCount = 50) {
  const picked = [];
  const seen = new Set();
  const add = (comment) => {
    if (!comment.text || seen.has(comment.id) || picked.length >= targetCount) return;
    seen.add(comment.id);
    picked.push(comment);
  };

  for (const group of commentGroups) {
    for (const comment of shuffle(group)) add(comment);
  }
  for (const comment of shuffle(randomItems)) add(comment);

  return shuffle(picked).map((comment, index) => ({ ...comment, index: index + 1 }));
}

function commentStats(comments) {
  return comments.reduce(
    (stats, comment) => {
      const key = comment.recommendDegree || "随机";
      stats[key] = (stats[key] || 0) + 1;
      return stats;
    },
    { total: comments.length },
  );
}

async function fetchMixedComments(scriptId) {
  const [recommend, common, bad, firstRandom] = await Promise.all([
    postMiquan("script/v2/getH5ScriptEvaluateList", { scriptId, searchType: 3 }),
    postMiquan("script/v2/getH5ScriptEvaluateList", { scriptId, searchType: 5 }),
    postMiquan("script/v2/getH5ScriptEvaluateList", { scriptId, searchType: 6 }),
    postMiquan("gameWeb/getScriptEvaluateList", { scriptId, searchType: 3, pageNum: 1, pageSize: 50 }),
  ]);

  const pages = Number(firstRandom.data?.pages || 1);
  const randomPage = pages > 1 ? Math.floor(Math.random() * pages) + 1 : 1;
  const random =
    randomPage === 1
      ? firstRandom
      : await postMiquan("gameWeb/getScriptEvaluateList", {
          scriptId,
          searchType: 3,
          pageNum: randomPage,
          pageSize: 50,
        });

  return {
    totalEvaluateNum:
      recommend.data?.totalEvaluateNum || firstRandom.data?.totalSize || common.data?.totalEvaluateNum || bad.data?.totalEvaluateNum,
    comments: mixComments(
      [
        (recommend.data?.items || []).map((item) => normalizeComment(item, "推荐池")),
        (common.data?.items || []).map((item) => normalizeComment(item, "一般池")),
        (bad.data?.items || []).map((item) => normalizeComment(item, "极差池")),
      ],
      (random.data?.items || []).map((item) => normalizeComment(item, `随机页 ${randomPage}`)),
    ),
  };
}

function normalizeDetail(input, detail, evalSummary) {
  const d = detail.data || {};
  const issueItems = d.scriptIssueInfoItems || [];
  const publisher = issueItems.find((item) => item.issueType === 1)?.issueName;
  const author = issueItems.find((item) => item.issueType === 2)?.issueName;
  const issueTimestamp = Number(d.scriptIssueUnitTime);
  const issueDate = Number.isFinite(issueTimestamp)
    ? new Date(issueTimestamp).toISOString().slice(0, 10)
    : "";
  const comments = evalSummary.comments || [];

  const tags = String(d.scriptTag || "")
    .split("@")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const rawScore = d.recommendNum ?? d.scriptScore ?? d.score ?? d.recommendScore;
  const numericScore = Number(rawScore);
  const score = Number.isFinite(numericScore) ? (numericScore > 10 ? numericScore / 10 : numericScore) : null;

  return {
    input,
    fetchedAt: new Date().toISOString(),
    scriptId: d.scriptId,
    scriptName: String(d.scriptName || "").trim(),
    score,
    scores: scoreMap(d.scriptLabelNames || [], d.scriptLabelScores || []),
    wantCount: d.scriptWantPlayerCount,
    playedCount: d.scriptPlayedCount,
    commentCount: d.scriptScoreCount ?? evalSummary.totalEvaluateNum,
    totalEvaluateNum: evalSummary.totalEvaluateNum,
    fetchedCommentCount: comments.length,
    commentSampleMode: "推荐/一般/极差各取样，并随机补足至50条",
    commentStats: commentStats(comments),
    tags,
    tagText: tags.join(" / "),
    durationMinutes: d.groupDuration,
    durationHours: d.groupDuration ? Math.round((d.groupDuration / 60) * 10) / 10 : null,
    maleLimit: d.scriptMalePlayerLimit,
    femaleLimit: d.scriptFemalePlayerLimit,
    people: [d.scriptMalePlayerLimit, d.scriptFemalePlayerLimit].every((n) => n != null)
      ? `${d.scriptMalePlayerLimit}男${d.scriptFemalePlayerLimit}女`
      : "",
    publishTime: d.publishTime || d.releaseTime || d.publishDate || issueDate,
    authorName: d.authorName || d.scriptAuthor || author || "",
    publisherName: d.publisherName || d.publishName || d.publisher || publisher || "",
    difficulty: d.scriptDifficultyDegreeName || "",
    intro: d.scriptTextContent || d.scriptIntro || "",
    coverUrl: d.scriptCoverUrl || "",
    rawDetail: d,
    comments,
  };
}

async function fetchScript(input) {
  const resolved = await resolveInputToScriptId(input);
  const scriptId = resolved.scriptId;

  const [detail, evalSummary] = await Promise.all([
    postMiquan("script/v2/platformScriptInfo", { scriptId }),
    fetchMixedComments(scriptId),
  ]);

  if (detail.head?.code !== 200) {
    throw new Error(detail.head?.msg || "详情接口返回异常");
  }
  const data = normalizeDetail(input, detail, evalSummary);
  data.resolvedFrom = resolved.resolvedFrom;
  data.sourceCategory = resolved.sourceCategory || sourceCategoryFromTags(data.tags, "谜圈-分享链接");
  data.shareUrl = `https://m.helloaa.cn/pages/share/newScriptDetail/newScriptDetail?PAGE=trendplay%3A%2F%2FscriptDetail%3FscriptId%3D${scriptId}&id=${scriptId}&channelCode=100&channelId=6&inviteUniqueId=VacMKx4q&lp=1`;
  return data;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
      }[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(content);
  });
}

// ===== 千岛数据 =====
const QIANDAO_SCRIPTS_PATH = path.join(__dirname, "work", "qiandao_scripts.json");
const MIQUAN_FIXED_PATH = path.join(__dirname, "work", "miquan_fixed.json");
let qiandaoScriptsCache = null;

function loadQiandaoScripts() {
  if (qiandaoScriptsCache) return qiandaoScriptsCache;
  if (!fs.existsSync(QIANDAO_SCRIPTS_PATH)) return buildQiandaoFromHar();
  try {
    qiandaoScriptsCache = JSON.parse(fs.readFileSync(QIANDAO_SCRIPTS_PATH, "utf8"));
    return qiandaoScriptsCache;
  } catch { return []; }
}

function buildQiandaoFromHar() {
  const scripts = {};
  const harPaths = [];
  // Scan work/ for non-miquan HAR files
  const workDir = path.join(__dirname, "work");
  if (fs.existsSync(workDir)) {
    fs.readdirSync(workDir)
      .filter(f => f.toLowerCase().endsWith(".har") && !f.startsWith("miquan-"))
      .forEach(f => harPaths.push(path.join(workDir, f)));
  }
  // Also scan Downloads
  const downloadsDir = "C:\\Users\\lenovo\\Downloads";
  if (fs.existsSync(downloadsDir)) {
    fs.readdirSync(downloadsDir)
      .filter(f => f.includes("千岛") && f.toLowerCase().endsWith(".har"))
      .forEach(f => harPaths.push(path.join(downloadsDir, f)));
  }
  for (const harPath of harPaths) {
    try {
      const har = JSON.parse(fs.readFileSync(harPath, "utf8"));
      for (const entry of har.log?.entries || []) {
        const reqUrl = entry.request?.url || "";
        const method = entry.request?.method || "";
        const respText = entry.response?.content?.text;
        if (!respText) continue;
        try {
          const json = JSON.parse(respText);
          if (json.code !== 0 && json.code !== "0") continue;
          if (reqUrl.includes("/spus/feed") && method === "POST") {
            for (const item of (json.data?.list || [])) {
              if (scripts[item.id]) continue;
              const profiles = {};
              for (const p of (item.profiles || [])) {
                const vals = (p.profiles || []).map(v => v.dataValue);
                profiles[p.propertyName] = vals.length === 1 ? vals[0] : vals.join(" / ");
              }
              scripts[item.id] = {
                id: item.id, name: item.name,
                rating: item.rate?.rating,
                wishCount: Number(item.wishCount) || 0,
                tagLine: item.keyPropertyContent || "",
                publisher: item.mainTagDisplayName || "",
                profiles, cover: item.cover || item.image || "",
                typeName: item.typeName || "室内娱乐",
                source: "千岛",
              };
            }
          }
          if (reqUrl.includes("simpleInfo") && method === "GET") {
            const h = json.data?.header || {};
            const entryId = new URL(reqUrl).searchParams.get("entryId");
            if (entryId && scripts[entryId]) {
              scripts[entryId].cover = h.cover?.image || scripts[entryId].cover;
              scripts[entryId].relatedText = h.relatedText || "";
              scripts[entryId].detailProfiles = {};
              for (const bp of (h.baseKeyPropertyInfos || [])) {
                scripts[entryId].detailProfiles[bp.propertyName] = bp.dataValue;
              }
            }
          }
        } catch {}
      }
    } catch {}
  }
  const result = Object.values(scripts);
  qiandaoScriptsCache = result;
  try { fs.writeFileSync(QIANDAO_SCRIPTS_PATH, JSON.stringify(result, null, 2)); } catch {}
  return result;
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/fetch") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const reasoningOnly = payload.reasoningOnly !== false;
        const lines = String(payload.links || "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const uniqueLines = [...new Set(lines)];
        const results = [];
        for (const line of uniqueLines) {
          try {
            const data = await fetchScript(line);
            const isTargetScript = (data.tags || []).some((tag) => TARGET_TAGS.includes(tag));
            if (reasoningOnly && !isTargetScript) {
              results.push({
                ok: false,
                skipped: true,
                input: line,
                error: `《${data.scriptName || data.scriptId}》不是推理/还原本，已跳过`,
              });
            } else {
              results.push({ ok: true, data });
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
          } catch (error) {
            results.push({ ok: false, input: line, error: error.message });
          }
        }
        sendJson(res, 200, { results });
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/fetch-rank") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const limit = Math.max(1, Math.min(Number(payload.limit || 60), 60));
        const items = (await fetchReasoningRankItems()).slice(0, limit);
        const results = [];
        for (const item of items) {
          try {
            const data = await fetchScript(item.scriptId);
            data.sourceCategory = item.sourceCategory || data.sourceCategory;
            data.resolvedFrom = item.sourceName ? `${item.sourceName}导入：${item.scriptName || item.scriptId}` : data.resolvedFrom;
            results.push({ ok: true, data });
            await new Promise((resolve) => setTimeout(resolve, 350));
          } catch (error) {
            results.push({ ok: false, input: item.scriptName, error: error.message });
          }
        }
        sendJson(res, 200, { results });
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/fetch-sources") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const reasoningOnly = payload.reasoningOnly !== false;
        const limit = Math.max(1, Math.min(Number(payload.limit || 1000), 5000));
        const allCandidates = fetchHarLibraryItems();
        const candidates = allCandidates.slice(0, limit);
        const results = candidates.map((item) => {
          const data = normalizeHarLibraryItem(item);
          const isTargetScript = (data.tags || []).some((tag) => TARGET_TAGS.includes(tag));
          if (reasoningOnly && !isTargetScript) {
            return {
              ok: false,
              skipped: true,
              input: item.scriptName || item.scriptId,
              error: `《${data.scriptName || data.scriptId}》不是推理/还原本，已跳过`,
            };
          }
          return { ok: true, data };
        });
        sendJson(res, 200, { totalCandidateCount: allCandidates.length, candidateCount: candidates.length, results });
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/har-data") {
    const allCandidates = fetchHarLibraryItems();
    const results = allCandidates.map((item) => ({ ok: true, data: normalizeHarLibraryItem(item) }));
    sendJson(res, 200, {
      totalCandidateCount: allCandidates.length,
      candidateCount: allCandidates.length,
      results,
    });
    return;
  }

  // 修正单个剧本：用详情API获取真实评分
  if (req.method === "POST" && req.url === "/api/fix-script") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const scriptId = String(payload.scriptId || "").trim();
        if (!scriptId) {
          sendJson(res, 400, { error: "缺少 scriptId" });
          return;
        }
        const data = await fetchScript(scriptId);
        data.dataQuality = "api-verified";
        data.fixedAt = new Date().toISOString();
        sendJson(res, 200, { ok: true, data });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  // 批量修正：按 scriptIds 数组逐条调用详情API
  if (req.method === "POST" && req.url === "/api/fix-batch") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const scriptIds = (payload.scriptIds || []).map((id) => String(id).trim()).filter(Boolean);
        const uniqueIds = [...new Set(scriptIds)];
        if (!uniqueIds.length) {
          sendJson(res, 400, { error: "缺少 scriptIds" });
          return;
        }
        const results = [];
        for (let i = 0; i < uniqueIds.length; i += 1) {
          try {
            const data = await fetchScript(uniqueIds[i]);
            data.dataQuality = "api-verified";
            data.fixedAt = new Date().toISOString();
            results.push({ ok: true, index: i, scriptId: uniqueIds[i], data });
          } catch (error) {
            results.push({ ok: false, index: i, scriptId: uniqueIds[i], error: error.message });
          }
          if (i < uniqueIds.length - 1) await sleep(300);
        }
        sendJson(res, 200, {
          total: uniqueIds.length,
          success: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
          results,
        });
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
    });
    return;
  }

  // 千岛剧本数据
  if (req.method === "GET" && req.url === "/api/qiandao-data") {
    const scripts = loadQiandaoScripts();
    sendJson(res, 200, { total: scripts.length, scripts });
    return;
  }

  // 谜圈修正数据
  if (req.method === "GET" && req.url === "/api/miquan-fixed") {
    if (!fs.existsSync(MIQUAN_FIXED_PATH)) {
      sendJson(res, 200, { total: 0, scripts: {} });
      return;
    }
    try {
      const data = JSON.parse(fs.readFileSync(MIQUAN_FIXED_PATH, "utf8"));
      const arr = Object.entries(data).map(([id, info]) => ({ scriptId: id, ...info }));
      sendJson(res, 200, { total: arr.length, scripts: arr });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/qiandao-reload") {
    qiandaoScriptsCache = null;
    const scripts = buildQiandaoFromHar();
    sendJson(res, 200, { total: scripts.length, message: `已重新解析 HAR，共 ${scripts.length} 个剧本` });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Miquan dashboard: http://localhost:${PORT}`);
  const qd = loadQiandaoScripts();
  console.log(`千岛剧本数据: ${qd.length} 个`);
});
