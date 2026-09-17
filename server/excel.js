import ExcelJS from "exceljs";

function toPlainNumber(text) {
  if (!text) return null;
  if (text.includes("확인 필요")) return null;
  const cleaned = String(text).replace(/[,\s원]/g, "");
  if (/^\d+$/.test(cleaned)) return Number(cleaned);
  return null;
}

// rows: [{ company?, coverageName, amount, term, premium }]
function addCoverageSheet(workbook, rows, name) {
  const sheet = workbook.addWorksheet(name);
  const withCompany = rows.some((row) => row.company);

  sheet.columns = [
    ...(withCompany ? [{ header: "보험사", key: "company", width: 12 }] : []),
    { header: "담보명", key: "coverageName", width: 50 },
    { header: "가입금액", key: "amount", width: 18 },
    { header: "납입기간·만기", key: "term", width: 20 },
    { header: "보험료", key: "premium", width: 16 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  const lastColumn = sheet.columns.length;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: lastColumn } };

  for (const row of rows) {
    const excelRow = sheet.addRow({
      ...(withCompany ? { company: row.company || "" } : {}),
      coverageName: row.coverageName || "",
      amount: row.amount || "",
      term: row.term || "",
    });

    const premiumCell = excelRow.getCell("premium");
    const numeric = toPlainNumber(row.premium);
    if (numeric !== null) {
      premiumCell.value = numeric;
      premiumCell.numFmt = "#,##0";
    } else {
      premiumCell.value = row.premium || "";
    }
  }

  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: "middle", wrapText: true };
    });
  });
  return sheet;
}

export async function buildCoverageWorkbook(rows) {
  const workbook = new ExcelJS.Workbook();
  addCoverageSheet(workbook, rows, "담보정리");
  return workbook;
}

// A4 가로로 인쇄되도록 설정한다. onePage 면 한 장에 모두 들어가게 줄인다.
function setA4Landscape(sheet, lastColumn, lastRow, onePage) {
  sheet.pageSetup = {
    ...sheet.pageSetup,
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: onePage ? 1 : 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    printArea: `A1:${sheet.getColumn(lastColumn).letter}${lastRow}`,
  };
}

const SIDES = ["상해", "질병"];

// 양식 없이 바로 받는 정리 엑셀.
// '합계표' 시트(A4 가로 한 장): 회사별 담보 표 → 바로 아래 회사별 합계 → 간병 페이백 → 이 보험의 장점. '담보목록' 시트: 원문 담보.
// matrix: [{ company, premium, cells: { 항목: { 상해, 질병 } } }] (보험료 낮은 순)
// summary: [{ label, byCompany: { 회사: { 상해, 질병 } } }]
export async function buildSummaryWorkbook({ matrix, categories, summary, paybackNotes, summaryLines, rows }) {
  const workbook = new ExcelJS.Workbook();
  const NAVY = "FF0E1E3A";
  const GOLD_SOFT = "FFFBF3DC";
  const GRAY_SOFT = "FFF3F5F9";
  const line = { style: "thin", color: { argb: "FFC5CCD8" } };
  const boxed = { top: line, left: line, bottom: line, right: line };
  const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const font = "Malgun Gothic";

  const sheet = workbook.addWorksheet("합계표", { views: [{ showGridLines: false }] });
  const companyCount = Math.max(matrix.length, 1);
  const lastCol = 1 + companyCount * 2;
  // A4 가로 한 장 너비(약 140자)를 회사 칸이 나눠 쓰도록 폭을 정한다.
  const valueWidth = Math.max(8, Math.min(26, Math.floor((140 - 24) / (companyCount * 2))));
  const mergedWidth = valueWidth * companyCount * 2;
  const linesFor = (text, width) => Math.max(1, Math.ceil((String(text).length * 1.9) / width));
  sheet.getColumn(1).width = 24;
  for (let c = 2; c <= lastCol; c++) sheet.getColumn(c).width = valueWidth;

  const style = (row, col, opts = {}) => {
    const cell = sheet.getCell(row, col);
    cell.font = { name: font, size: opts.size || 10, bold: Boolean(opts.bold), color: opts.color ? { argb: opts.color } : undefined };
    cell.alignment = { horizontal: opts.align || "center", vertical: "middle", wrapText: Boolean(opts.wrap) };
    cell.border = boxed;
    if (opts.bg) cell.fill = fill(opts.bg);
    if (opts.numFmt) cell.numFmt = opts.numFmt;
  };

  /* 제목 */
  let r = 1;
  sheet.mergeCells(r, 1, r, lastCol);
  sheet.getCell(r, 1).value = "가입제안서 담보 정리 — 입원·간병 보장 비교";
  sheet.getCell(r, 1).font = { name: font, size: 16, bold: true, color: { argb: NAVY } };
  sheet.getCell(r, 1).alignment = { horizontal: "left", vertical: "middle" };
  sheet.getRow(r).height = 28;
  r++;
  sheet.mergeCells(r, 1, r, lastCol);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  sheet.getCell(r, 1).value = `작성일 ${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} · 보험사는 월 보험료 낮은 순 · 금액 단위: 일당 만원 / 보험료 원`;
  sheet.getCell(r, 1).font = { name: font, size: 9, color: { argb: "FF6B7280" } };
  r += 2;

  /* 회사별 담보 표 */
  const nameRow = r;
  const sideRow = r + 1;
  sheet.mergeCells(nameRow, 1, sideRow, 1);
  sheet.getCell(nameRow, 1).value = "항목";
  matrix.forEach((entry, i) => {
    const left = 2 + i * 2;
    sheet.mergeCells(nameRow, left, nameRow, left + 1);
    sheet.getCell(nameRow, left).value = entry.company;
    sheet.getCell(sideRow, left).value = "상해";
    sheet.getCell(sideRow, left + 1).value = "질병";
  });
  for (let c = 1; c <= lastCol; c++) {
    style(nameRow, c, { bold: true, color: "FFFFFFFF", bg: NAVY, size: 11 });
    style(sideRow, c, { bold: true, bg: GRAY_SOFT, size: 9 });
  }
  sheet.getRow(nameRow).height = 22;
  r = sideRow + 1;

  const writeValues = (label, valueAt, opts = {}) => {
    sheet.getCell(r, 1).value = label;
    style(r, 1, { bold: true, align: "left", bg: opts.bg });
    matrix.forEach((entry, i) => {
      SIDES.forEach((side, j) => {
        const value = valueAt(entry, side);
        if (value !== undefined && value !== null && value !== "" && value !== 0) sheet.getCell(r, 2 + i * 2 + j).value = value;
        style(r, 2 + i * 2 + j, { bg: opts.bg, bold: opts.bold });
      });
    });
    sheet.getRow(r).height = 18;
    r++;
  };

  for (const category of categories) writeValues(category, (entry, side) => entry.cells?.[category]?.[side]);

  // 월 보험료: 회사당 두 칸을 합쳐 한 번만.
  sheet.getCell(r, 1).value = "월 보험료";
  style(r, 1, { bold: true, align: "left", bg: GRAY_SOFT });
  matrix.forEach((entry, i) => {
    const left = 2 + i * 2;
    sheet.mergeCells(r, left, r, left + 1);
    if (Number.isFinite(entry.premium)) sheet.getCell(r, left).value = entry.premium;
    style(r, left, { bold: true, bg: GRAY_SOFT, numFmt: '#,##0"원"' });
    style(r, left + 1, { bg: GRAY_SOFT });
  });
  sheet.getRow(r).height = 20;
  r++;

  /* 회사별 합계 — 같은 표 바로 아래 */
  if (summary.length > 0) {
    sheet.mergeCells(r, 1, r, lastCol);
    sheet.getCell(r, 1).value = "합계 (하루 입원 시 받는 금액 · 만원)";
    for (let c = 1; c <= lastCol; c++) style(r, c, { bold: true, color: "FFFFFFFF", bg: NAVY, align: "left" });
    sheet.getRow(r).height = 20;
    r++;
    for (const row of summary) {
      writeValues(row.label, (entry, side) => row.byCompany?.[entry.company]?.[side], { bg: GOLD_SOFT, bold: true });
    }
  }
  let lastRow = r - 1;

  /* 간병 페이백 */
  if (paybackNotes.length > 0) {
    r++;
    sheet.getCell(r, 1).value = "간병 페이백 안내";
    sheet.getCell(r, 1).font = { name: font, size: 11, bold: true, color: { argb: NAVY } };
    r++;
    for (const note of paybackNotes) {
      sheet.getCell(r, 1).value = note.company;
      style(r, 1, { bold: true, align: "left" });
      sheet.mergeCells(r, 2, r, lastCol);
      sheet.getCell(r, 2).value = note.text;
      style(r, 2, { align: "left", wrap: true });
      sheet.getRow(r).height = linesFor(note.text, mergedWidth) * 15 + 6;
      r++;
    }
    lastRow = r - 1;
  }

  /* 이 보험의 장점 */
  if (summaryLines.length > 0) {
    r++;
    sheet.getCell(r, 1).value = "이 보험의 장점";
    sheet.getCell(r, 1).font = { name: font, size: 11, bold: true, color: { argb: NAVY } };
    r++;
    for (const text of summaryLines) {
      sheet.mergeCells(r, 1, r, lastCol);
      const isHeading = text.startsWith("[");
      sheet.getCell(r, 1).value = text;
      sheet.getCell(r, 1).font = { name: font, size: 10, bold: isHeading, color: isHeading ? { argb: NAVY } : undefined };
      sheet.getCell(r, 1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      sheet.getRow(r).height = linesFor(text, mergedWidth + 24) * 15 + 3;
      r++;
    }
    lastRow = r - 1;
  }

  setA4Landscape(sheet, lastCol, lastRow, true);

  const list = addCoverageSheet(workbook, rows, "담보목록");
  setA4Landscape(list, list.columns.length, Math.max(1, rows.length + 1), false);

  return workbook;
}

export function buildExportFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  return `가입제안서_담보정리_${y}${m}${d}_${hh}${mm}.xlsx`;
}
