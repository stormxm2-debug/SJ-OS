import ExcelJS from "exceljs";

// 사용자가 준 엑셀 양식을 그대로 열어 값만 채운다. 서식·수식·열 너비는 건드리지 않는다.
// 양식마다 항목 이름이 있는 열과 회사 칸 위치가 다르므로 "회사명" 칸을 찾아 기준을 잡는다.
// 회사마다 두 칸(왼쪽 상해 / 오른쪽 질병)을 쓴다.

const COMPANY_PAIRS = 11; // 회사명 칸 오른쪽으로 쓸 수 있는 회사 수

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (value.richText) return value.richText.map((t) => t.text).join("");
    if (value.text) return value.text;
    if (value.result !== undefined) return String(value.result);
    return "";
  }
  return String(value);
}

const norm = (value) => cellText(value).replace(/\s/g, "");

// 시트에서 "회사명" 칸을 찾아 항목 열·회사 행·회사 칸 위치를 알아낸다.
function findLayout(sheet) {
  let companyRow = null;
  let labelColumn = null;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (companyRow) return;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (!companyRow && norm(cell.value) === "회사명") {
        companyRow = rowNumber;
        labelColumn = colNumber;
      }
    });
  });
  if (!companyRow) return null;

  const rowByLabel = new Map();
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === companyRow) return;
    const label = norm(row.getCell(labelColumn).value);
    if (label && !rowByLabel.has(label)) rowByLabel.set(label, rowNumber);
  });

  const slots = [];
  for (let i = 0; i < COMPANY_PAIRS; i++) {
    const left = labelColumn + 1 + i * 2;
    slots.push({ left, right: left + 1, name: norm(sheet.getRow(companyRow).getCell(left).value) });
  }

  return { companyRow, labelColumn, rowByLabel, slots };
}

// 양식 안에서 담보표가 들어 있는 시트 후보를 찾는다.
export function inspectTemplate(workbook) {
  const sheets = [];
  for (const sheet of workbook.worksheets) {
    const layout = findLayout(sheet);
    if (!layout) continue;
    sheets.push({
      name: sheet.name,
      companies: layout.slots.filter((slot) => slot.name).map((slot) => slot.name),
      labels: [...layout.rowByLabel.keys()],
    });
  }
  return sheets;
}

function chooseSheet(workbook, sheetName) {
  if (sheetName) {
    const wanted = workbook.worksheets.find((sheet) => sheet.name === sheetName);
    if (wanted && findLayout(wanted)) return wanted;
  }
  // 이미 회사가 많이 적혀 있는 시트를 우선한다(빈 사본 시트에 잘못 채우지 않도록).
  let best = null;
  let bestScore = -1;
  for (const sheet of workbook.worksheets) {
    const layout = findLayout(sheet);
    if (!layout) continue;
    const score = layout.slots.filter((slot) => slot.name).length;
    if (score > bestScore) {
      best = sheet;
      bestScore = score;
    }
  }
  return best;
}

export async function loadTemplate(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

/**
 * matrix: [{ company, premium, cells: { [항목]: { 상해: number|string|null, 질병: ... } } }]
 */
// 기존 표와 수식은 그대로 두고, 시트 맨 아래에 최종 합계표와 간병 페이백 안내를 덧붙인다.
function writeSummaryBlock(sheet, layout, extras = {}) {
  const summary = Array.isArray(extras.summary) ? extras.summary : [];
  const notes = Array.isArray(extras.paybackNotes) ? extras.paybackNotes : [];
  if (summary.length === 0 && notes.length === 0) return;

  const column = layout.labelColumn;
  let rowNumber = sheet.rowCount + 2;

  const put = (row, col, value, bold = false) => {
    const cell = sheet.getRow(row).getCell(col);
    cell.value = value;
    if (bold) cell.font = { ...(cell.font || {}), bold: true };
  };

  if (summary.length > 0) {
    put(rowNumber++, column, "최종 합계표 (하루 입원 시 받는 금액, 만원)", true);
    put(rowNumber, column, "상황", true);
    put(rowNumber, column + 1, "상해", true);
    put(rowNumber, column + 2, "질병", true);
    rowNumber++;
    for (const item of summary) {
      put(rowNumber, column, item.label);
      if (Number.isFinite(item["상해"])) put(rowNumber, column + 1, item["상해"]);
      if (Number.isFinite(item["질병"])) put(rowNumber, column + 2, item["질병"]);
      rowNumber++;
    }
    rowNumber++;
  }

  if (notes.length > 0) {
    put(rowNumber++, column, "간병 페이백 안내", true);
    for (const note of notes) {
      put(rowNumber, column, note.company);
      put(rowNumber, column + 1, note.text);
      rowNumber++;
    }
  }
}

export async function fillTemplate(templateBuffer, matrix, sheetName, extras = {}) {
  const workbook = await loadTemplate(templateBuffer);
  const sheet = chooseSheet(workbook, sheetName);
  if (!sheet) throw new Error("엑셀 양식에서 '회사명' 칸이 있는 시트를 찾지 못했습니다.");

  const layout = findLayout(sheet);
  const { companyRow, rowByLabel, slots } = layout;
  const used = new Set();
  const skippedCompanies = [];
  let filled = 0;

  for (const entry of matrix) {
    const companyName = String(entry.company || "").trim();
    if (!companyName) continue;
    const compact = companyName.replace(/\s/g, "");

    let slot = slots.find((s) => s.name === compact && !used.has(s.left));
    if (!slot) slot = slots.find((s) => !s.name && !used.has(s.left));
    if (!slot) {
      skippedCompanies.push(companyName);
      continue;
    }
    used.add(slot.left);
    if (!slot.name) {
      sheet.getRow(companyRow).getCell(slot.left).value = companyName;
      slot.name = compact;
    }

    for (const [label, sides] of Object.entries(entry.cells || {})) {
      const rowNumber = rowByLabel.get(label.replace(/\s/g, ""));
      if (!rowNumber) continue;
      const row = sheet.getRow(rowNumber);
      for (const [side, value] of Object.entries(sides)) {
        if (value === null || value === undefined || value === "") continue;
        row.getCell(side === "질병" ? slot.right : slot.left).value = value;
        filled++;
      }
    }

    const premiumRow = rowByLabel.get("보험료");
    if (premiumRow && Number.isFinite(entry.premium)) {
      sheet.getRow(premiumRow).getCell(slot.left).value = entry.premium;
      sheet.getRow(premiumRow).getCell(slot.right).value = entry.premium;
      filled += 2;
    }
  }

  writeSummaryBlock(sheet, layout, extras);

  // 총보험료·입원일당 합계 같은 수식이 엑셀을 열 때 바로 다시 계산되도록 한다.
  workbook.calcProperties = { ...(workbook.calcProperties || {}), fullCalcOnLoad: true };

  return { workbook, filled, skippedCompanies, sheetName: sheet.name };
}
