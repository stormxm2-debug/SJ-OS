import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";

import { loadPdf, extractPageText, renderPageToPng } from "./extract/pdfText.js";
import { ocrImageBuffer, terminateOcr } from "./extract/ocr.js";
import { parseCoverageTable } from "./extract/parseTable.js";
import {
  classifyCoverage,
  detectCompany,
  detectPayback,
  findTotalPremium,
  applyFileLevelRules,
  CATEGORIES,
} from "./classify.js";
import { fillTemplate } from "./templateFill.js";
import { buildCoverageWorkbook, buildExportFileName } from "./excel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const upload = multer({
  storage: multer.memoryStorage(), // 파일을 디스크에 저장하지 않고 메모리에서만 처리 후 즉시 폐기
  limits: { fileSize: 25 * 1024 * 1024, files: 12 },
});

const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);

async function pagesFromFile(file) {
  const looksPdf = file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname || "");
  if (!looksPdf) {
    return [{ pageNum: 1, items: await ocrImageBuffer(file.buffer) }];
  }
  const doc = await loadPdf(new Uint8Array(file.buffer));
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const { items } = await extractPageText(page);
    if (items.length > 0) {
      pages.push({ pageNum: i, items });
    } else {
      // 텍스트 레이어가 없는 스캔 페이지 -> 이미지로 렌더링 후 OCR
      pages.push({ pageNum: i, items: await ocrImageBuffer(await renderPageToPng(page)) });
    }
  }
  return pages;
}

function checkFile(file) {
  if (/heic|heif/i.test(file.mimetype)) {
    return "아이폰 HEIC 사진은 지원하지 않습니다. JPG로 저장한 뒤 다시 올려주세요.";
  }
  const looksPdfByName = /\.pdf$/i.test(file.originalname || "");
  if (!ALLOWED_MIME.has(file.mimetype) && !looksPdfByName) {
    return "PDF, JPG, PNG 파일만 업로드할 수 있습니다.";
  }
  return null;
}

app.get("/api/categories", (req, res) => {
  res.json({ categories: CATEGORIES });
});

app.post("/api/analyze", upload.array("files", 12), async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) {
    return res.status(400).json({ error: "업로드된 파일이 없습니다." });
  }

  const results = [];
  for (const file of files) {
    const fileName = file.originalname || "이름 없는 파일";
    const problem = checkFile(file);
    if (problem) {
      results.push({ fileName, error: problem, items: [], warnings: [] });
      continue;
    }
    try {
      const pages = await pagesFromFile(file);
      const { rows, warnings } = parseCoverageTable(pages);
      const items = rows.map((row, index) => {
        const classified = classifyCoverage(row.coverageName, row.amount);
        return {
          id: `${index}`,
          coverageName: row.coverageName,
          amount: row.amount,
          term: row.term,
          premium: row.premium,
          lowConfidenceFields: row.lowConfidenceFields || [],
          columnAmbiguous: !!row.columnAmbiguous,
          categories: classified.categories,
          sides: classified.sides,
          value: classified.value,
          needsReview: classified.needsReview,
          payback: classified.payback,
          reason: classified.reason || classified.valueReason || "",
        };
      });
      applyFileLevelRules(items);
      results.push({
        fileName,
        company: detectCompany(pages, fileName),
        totalPremium: findTotalPremium(pages),
        payback: detectPayback(pages) || items.some((item) => item.payback),
        warnings,
        items,
      });
    } catch (err) {
      // 문서 내용은 로그에 남기지 않고 오류 종류만 기록한다.
      console.error("[analyze] 처리 중 오류:", err.name, err.message);
      results.push({
        fileName,
        error: "이 파일을 분석하는 중 오류가 발생했습니다. 파일 형식을 확인해주세요.",
        items: [],
        warnings: [],
      });
    }
  }

  res.json({ files: results });
});

// 담보 목록 그대로 내려받기(담보명/가입금액/납입기간·만기/보험료)
app.post("/api/export", async (req, res) => {
  try {
    const { rows } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "엑셀로 내려받을 담보 목록이 없습니다." });
    }
    const workbook = await buildCoverageWorkbook(rows);
    const fileName = buildExportFileName();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[export] 처리 중 오류:", err.name, err.message);
    res.status(500).json({ error: "엑셀 파일을 만드는 중 오류가 발생했습니다." });
  }
});

// 사용자가 올린 양식에 값을 채워서 내려받기
app.post("/api/export-template", upload.single("template"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "엑셀 양식 파일을 올려주세요." });
    if (!/\.xlsx$/i.test(req.file.originalname || "")) {
      return res.status(400).json({ error: "엑셀 양식은 .xlsx 파일이어야 합니다." });
    }
    let matrix;
    try {
      matrix = JSON.parse(req.body.matrix || "[]");
    } catch {
      return res.status(400).json({ error: "보낼 데이터를 읽지 못했습니다." });
    }
    if (!Array.isArray(matrix) || matrix.length === 0) {
      return res.status(400).json({ error: "양식에 채울 내용이 없습니다. 담보를 하나 이상 체크해주세요." });
    }

    const { workbook, skippedCompanies } = await fillTemplate(req.file.buffer, matrix);
    const base = (req.file.originalname || "양식").replace(/\.xlsx$/i, "");
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const fileName = `${base}_${stamp}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
    if (skippedCompanies.length > 0) {
      res.setHeader("X-Skipped-Companies", encodeURIComponent(skippedCompanies.join(",")));
    }
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[export-template] 처리 중 오류:", err.name, err.message);
    res.status(500).json({ error: err.message || "양식을 채우는 중 오류가 발생했습니다." });
  }
});

const PORT = Number(process.env.PORT) || 4173;
// 기본은 이 PC에서만 접속 가능. --mobile 로 실행하면 같은 Wi-Fi의 휴대전화에서도 접속할 수 있다.
const MOBILE = process.argv.includes("--mobile");
const HOST = MOBILE ? "0.0.0.0" : "127.0.0.1";

const server = app.listen(PORT, HOST, () => {
  console.log(`SJ OS 담보정리 서버 실행 중: http://localhost:${PORT}`);
  if (MOBILE) {
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((a) => a && a.family === "IPv4" && !a.internal)
      .map((a) => a.address);
    for (const addr of addresses) {
      console.log(`휴대전화(같은 Wi-Fi)에서 접속: http://${addr}:${PORT}`);
    }
    console.log("주의: 휴대전화 접속 모드에는 로그인이 없습니다. 같은 네트워크의 다른 기기도 접속할 수 있으니 사용 후 서버를 종료하세요.");
  }
});

async function shutdown() {
  await terminateOcr();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
