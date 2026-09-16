import ExcelJS from "exceljs";

function toPlainNumber(text) {
  if (!text) return null;
  if (text.includes("확인 필요")) return null;
  const cleaned = String(text).replace(/[,\s원]/g, "");
  if (/^\d+$/.test(cleaned)) return Number(cleaned);
  return null;
}

// rows: [{ coverageName, amount, term, premium }]
export async function buildCoverageWorkbook(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("담보정리");

  sheet.columns = [
    { header: "담보명", key: "coverageName", width: 50 },
    { header: "가입금액", key: "amount", width: 18 },
    { header: "납입기간·만기", key: "term", width: 20 },
    { header: "보험료", key: "premium", width: 16 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  sheet.autoFilter = { from: "A1", to: "D1" };

  for (const row of rows) {
    const excelRow = sheet.addRow({
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
