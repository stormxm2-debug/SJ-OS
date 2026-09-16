import ExcelJS from "exceljs";

// 사용자가 준 엑셀 양식을 그대로 열어 값만 채운다. 서식·수식·열 너비는 건드리지 않는다.
// 양식 구조: C열 = 항목 이름, 3행 = 회사명, 회사마다 두 칸(왼쪽 상해 / 오른쪽 질병).

const LABEL_COLUMN = 3; // C
const FIRST_DATA_COLUMN = 4; // D
const LAST_DATA_COLUMN = 25; // Y

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

const norm = (s) => cellText(s).replace(/\s/g, "");

function findLayout(sheet) {
  let companyRow = null;
  const rowByLabel = new Map();
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const label = norm(row.getCell(LABEL_COLUMN).value);
    if (!label) return;
    if (label === "회사명") companyRow = rowNumber;
    else if (!rowByLabel.has(label)) rowByLabel.set(label, rowNumber);
  });
  return { companyRow, rowByLabel };
}

// 회사별 2칸 묶음(D/E, F/G ...)을 만든다.
function companySlots(sheet, companyRow) {
  const slots = [];
  for (let col = FIRST_DATA_COLUMN; col + 1 <= LAST_DATA_COLUMN; col += 2) {
    slots.push({ left: col, right: col + 1, name: norm(sheet.getRow(companyRow).getCell(col).value) });
  }
  return slots;
}

/**
 * matrix: [{ company, premium, cells: { [항목]: { 상해: number|string|null, 질병: ... } } }]
 * 반환: { workbook, filled, skippedCompanies }
 */
export async function fillTemplate(templateBuffer, matrix) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("엑셀 양식에서 시트를 찾지 못했습니다.");

  const { companyRow, rowByLabel } = findLayout(sheet);
  if (!companyRow) throw new Error("엑셀 양식에서 '회사명' 행을 찾지 못했습니다.");

  const slots = companySlots(sheet, companyRow);
  const used = new Set();
  const skippedCompanies = [];
  let filled = 0;

  for (const entry of matrix) {
    const companyName = String(entry.company || "").trim();
    if (!companyName) continue;

    let slot = slots.find((s) => s.name && s.name === companyName.replace(/\s/g, "") && !used.has(s.left));
    if (!slot) slot = slots.find((s) => !s.name && !used.has(s.left));
    if (!slot) {
      skippedCompanies.push(companyName);
      continue;
    }
    used.add(slot.left);
    if (!slot.name) {
      sheet.getRow(companyRow).getCell(slot.left).value = companyName;
      slot.name = companyName.replace(/\s/g, "");
    }

    for (const [label, sides] of Object.entries(entry.cells || {})) {
      const rowNumber = rowByLabel.get(label.replace(/\s/g, ""));
      if (!rowNumber) continue;
      const row = sheet.getRow(rowNumber);
      for (const [side, value] of Object.entries(sides)) {
        if (value === null || value === undefined || value === "") continue;
        const cell = row.getCell(side === "질병" ? slot.right : slot.left);
        cell.value = value;
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

  return { workbook, filled, skippedCompanies };
}
