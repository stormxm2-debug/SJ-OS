(() => {
  const $ = (id) => document.getElementById(id);

  const dropZone = $("dropZone");
  const fileInput = $("fileInput");
  const pendingList = $("pendingList");
  const analyzeBtn = $("analyzeBtn");
  const progressText = $("progressText");
  const uploadError = $("uploadError");

  const filesPanel = $("filesPanel");
  const fileCards = $("fileCards");
  const itemsPanel = $("itemsPanel");
  const itemGroups = $("itemGroups");
  const matrixPanel = $("matrixPanel");
  const matrixTable = $("matrixTable");
  const resultError = $("resultError");

  const GROUP_SANGGEUP = "상급 1인/2~3/4~5인실";
  const GROUP_GENERAL = "종합 1인/2~3/4~5인실";
  const SANGGEUP_ROOMS = ["상급1인실", "상급2~3인실", "상급4~5인실"];
  const GENERAL_ROOMS = ["종합1인실", "종합2~3인실", "종합4~5인실"];
  const UNMATCHED = "미분류";
  const SIDES = ["상해", "질병"];

  const state = {
    pending: [],
    files: [],
    categories: [],
    overrides: new Map(),
    templateFile: null,
    currentMatrix: null,
    advantagesEdited: false,
    nextId: 1,
  };

  const overrideKey = (company, category, side) => `${company}|${category}|${side}`;

  function categoriesOfChoice(choice) {
    if (!choice || choice === UNMATCHED) return [];
    if (choice === GROUP_SANGGEUP) return [...SANGGEUP_ROOMS];
    if (choice === GROUP_GENERAL) return [...GENERAL_ROOMS];
    return [choice];
  }

  function choiceOfCategories(categories) {
    if (!categories || categories.length === 0) return UNMATCHED;
    if (SANGGEUP_ROOMS.every((c) => categories.includes(c))) return GROUP_SANGGEUP;
    if (GENERAL_ROOMS.every((c) => categories.includes(c))) return GROUP_GENERAL;
    return categories[0];
  }

  /* ---------- 파일 고르기 ---------- */

  function isAllowed(file) {
    if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) return "heic";
    const okType = ["application/pdf", "image/jpeg", "image/jpg", "image/png"].includes(file.type);
    const okExt = /\.(pdf|jpe?g|png)$/i.test(file.name);
    return okType || okExt ? "ok" : "bad";
  }

  function addPending(fileList) {
    const rejected = [];
    for (const file of fileList) {
      if (/\.xlsx$/i.test(file.name)) {
        setTemplate(file); // 엑셀을 끌어다 놓으면 양식으로 쓴다
        continue;
      }
      const verdict = isAllowed(file);
      if (verdict === "heic") {
        rejected.push(`${file.name}: 아이폰 HEIC 사진은 지원하지 않습니다. JPG로 저장해 올려주세요.`);
        continue;
      }
      if (verdict === "bad") {
        rejected.push(`${file.name}: PDF, JPG, PNG만 올릴 수 있습니다.`);
        continue;
      }
      state.pending.push(file);
    }
    showError(uploadError, rejected.join("\n"));
    renderPending();
  }

  function renderPending() {
    pendingList.innerHTML = "";
    state.pending.forEach((file, index) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = file.name;
      const remove = document.createElement("button");
      remove.className = "link-btn";
      remove.type = "button";
      remove.textContent = "제거";
      remove.addEventListener("click", () => {
        state.pending.splice(index, 1);
        renderPending();
      });
      li.append(name, remove);
      pendingList.appendChild(li);
    });
    analyzeBtn.disabled = state.pending.length === 0;
    analyzeBtn.textContent = state.files.length > 0 ? "추가 분석하기" : "분석 시작";
  }

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
    addPending(event.dataTransfer.files);
  });
  fileInput.addEventListener("change", () => {
    addPending(fileInput.files);
    fileInput.value = "";
  });

  function showError(element, message) {
    element.textContent = message || "";
    element.hidden = !message;
  }

  /* ---------- 분석 ---------- */

  analyzeBtn.addEventListener("click", async () => {
    if (state.pending.length === 0) return;
    const formData = new FormData();
    for (const file of state.pending) formData.append("files", file);

    analyzeBtn.disabled = true;
    progressText.hidden = false;
    progressText.textContent = `문서 ${state.pending.length}건을 분석하고 있습니다. 스캔·사진은 한 건당 10초 안팎 걸립니다...`;
    showError(uploadError, "");

    try {
      const response = await fetch("/api/analyze", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "분석 중 오류가 발생했습니다.");

      const failed = [];
      for (const result of data.files) {
        if (result.error) {
          failed.push(`${result.fileName}: ${result.error}`);
          continue;
        }
        state.files.push({
          id: state.nextId++,
          fileName: result.fileName,
          company: result.company || "",
          totalPremium: result.totalPremium,
          payback: !!result.payback,
          paybackNote: result.paybackNote || null,
          warnings: result.warnings || [],
          items: result.items.map((item, index) => ({
            key: `${state.nextId}-${index}`,
            coverageName: item.coverageName,
            amount: item.amount,
            term: item.term,
            premium: item.premium,
            choice: choiceOfCategories(item.categories),
            sideChoice: item.sides.length === 2 ? "양쪽" : item.sides[0] || "양쪽",
            dailyValue: item.value === null || item.value === undefined ? "" : String(item.value),
            needsReview: !!item.needsReview,
            reason: item.reason || "",
            checked: item.categories.length > 0,
          })),
        });
      }
      state.pending = [];
      showError(uploadError, failed.join("\n"));
      renderAll();
      if (state.files.length > 0) showTab("items"); // 분석이 끝나면 담보 선택 화면으로
    } catch (error) {
      showError(uploadError, error.message || "분석 중 오류가 발생했습니다.");
    } finally {
      progressText.hidden = true;
      renderPending();
    }
  });

  /* ---------- 분석된 파일 카드 ---------- */

  function renderFiles() {
    filesPanel.hidden = state.files.length === 0;
    fileCards.innerHTML = "";

    for (const file of state.files) {
      const card = document.createElement("div");
      card.className = "file-card";

      const name = document.createElement("div");
      name.className = "file-name";
      name.textContent = file.fileName;
      name.title = file.fileName;

      const companyField = document.createElement("div");
      companyField.className = "field";
      const companyLabel = document.createElement("label");
      companyLabel.textContent = "회사";
      const companyInput = document.createElement("input");
      companyInput.type = "text";
      companyInput.value = file.company;
      companyInput.placeholder = "회사명을 입력하세요";
      companyInput.addEventListener("input", () => {
        file.company = companyInput.value;
        renderMatrix();
      });
      companyField.append(companyLabel, companyInput);

      const premiumField = document.createElement("div");
      premiumField.className = "field";
      const premiumLabel = document.createElement("label");
      premiumLabel.textContent = "보험료";
      const premiumInput = document.createElement("input");
      premiumInput.type = "number";
      premiumInput.value = Number.isFinite(file.totalPremium) ? file.totalPremium : "";
      premiumInput.placeholder = "원";
      premiumInput.addEventListener("input", () => {
        file.totalPremium = premiumInput.value === "" ? null : Number(premiumInput.value);
        renderMatrix();
      });
      premiumField.append(premiumLabel, premiumInput);

      const footer = document.createElement("div");
      footer.className = "card-footer";
      const badge = document.createElement("span");
      badge.className = "badge";
      const checkedCount = file.items.filter((item) => item.checked).length;
      badge.textContent = `담보 ${file.items.length}건 · 체크 ${checkedCount}건${file.payback ? " · 페이백 o" : ""}`;
      const remove = document.createElement("button");
      remove.className = "link-btn";
      remove.type = "button";
      remove.textContent = "이 문서 빼기";
      remove.addEventListener("click", () => {
        state.files = state.files.filter((f) => f.id !== file.id);
        renderAll();
      });
      footer.append(badge, remove);

      card.append(name, companyField, premiumField, footer);
      if (!file.company) {
        const warn = document.createElement("div");
        warn.className = "muted";
        warn.textContent = "회사명을 찾지 못했습니다. 직접 입력해주세요.";
        card.appendChild(warn);
      }
      fileCards.appendChild(card);
    }
  }

  /* ---------- 담보 목록 ---------- */

  function renderItems() {
    itemsPanel.hidden = state.files.length === 0;
    itemGroups.innerHTML = "";

    for (const file of state.files) {
      const group = document.createElement("details");
      group.className = "item-group";
      group.open = true;
      const title = document.createElement("summary");
      const checkedCount = file.items.filter((item) => item.checked).length;
      title.textContent = `${file.company || "회사 미확인"} — ${file.fileName} (체크 ${checkedCount}/${file.items.length})`;
      group.appendChild(title);

      const table = document.createElement("table");
      table.className = "items-table";
      table.innerHTML = `
        <thead>
          <tr>
            <th></th><th>담보명</th><th>가입금액</th><th>납입기간·만기</th><th>보험료</th>
            <th>양식 항목</th><th>구분</th><th>일당(만원)</th>
          </tr>
        </thead>`;
      const tbody = document.createElement("tbody");

      for (const item of file.items) {
        const tr = document.createElement("tr");
        if (item.needsReview && item.checked) tr.classList.add("row-review");
        else if (categoriesOfChoice(item.choice).length === 0) tr.classList.add("row-unmatched");

        const checkTd = document.createElement("td");
        checkTd.className = "check-cell";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = item.checked;
        checkbox.addEventListener("change", () => {
          item.checked = checkbox.checked;
          renderFiles();
          renderMatrix();
          tr.classList.toggle("row-review", item.needsReview && item.checked);
        });
        checkTd.appendChild(checkbox);

        const nameTd = cell("담보명", item.coverageName);
        nameTd.classList.add("coverage-name");
        if (item.reason) nameTd.title = item.reason;

        const categoryTd = document.createElement("td");
        categoryTd.dataset.label = "양식 항목";
        const select = document.createElement("select");
        for (const option of [UNMATCHED, ...state.categories, GROUP_SANGGEUP, GROUP_GENERAL]) {
          const opt = document.createElement("option");
          opt.value = option;
          opt.textContent = option;
          if (option === item.choice) opt.selected = true;
          select.appendChild(opt);
        }
        select.addEventListener("change", () => {
          item.choice = select.value;
          item.checked = select.value !== UNMATCHED;
          checkbox.checked = item.checked;
          renderFiles();
          renderMatrix();
        });
        categoryTd.appendChild(select);

        const sideTd = document.createElement("td");
        sideTd.dataset.label = "구분";
        const sideSelect = document.createElement("select");
        for (const option of ["양쪽", ...SIDES]) {
          const opt = document.createElement("option");
          opt.value = option;
          opt.textContent = option;
          if (option === item.sideChoice) opt.selected = true;
          sideSelect.appendChild(opt);
        }
        sideSelect.addEventListener("change", () => {
          item.sideChoice = sideSelect.value;
          renderMatrix();
        });
        sideTd.appendChild(sideSelect);

        const valueTd = document.createElement("td");
        valueTd.dataset.label = "일당(만원)";
        const valueInput = document.createElement("input");
        valueInput.type = "text";
        valueInput.value = item.dailyValue;
        valueInput.placeholder = item.needsReview ? "직접 입력" : "";
        valueInput.addEventListener("input", () => {
          item.dailyValue = valueInput.value.trim();
          renderMatrix();
        });
        valueTd.appendChild(valueInput);

        tr.append(
          checkTd,
          nameTd,
          cell("가입금액", item.amount),
          cell("납입기간·만기", item.term),
          cell("보험료", item.premium),
          categoryTd,
          sideTd,
          valueTd
        );
        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      group.appendChild(table);
      itemGroups.appendChild(group);
    }
  }

  function cell(label, text) {
    const td = document.createElement("td");
    td.dataset.label = label;
    td.textContent = text || "";
    return td;
  }

  /* ---------- 최종 합계표: 회사별 담보 표 + 회사별 합계 ---------- */

  function premiumOf(entry) {
    const key = overrideKey(entry.company, "보험료", "상해");
    if (state.overrides.has(key)) {
      const raw = state.overrides.get(key);
      return raw === "" ? null : Number(raw);
    }
    return Number.isFinite(entry.premium) ? entry.premium : null;
  }

  // 보험사는 월 보험료가 낮은 회사부터 왼쪽 → 오른쪽 (보험료를 모르는 회사는 맨 뒤).
  function buildMatrix() {
    const byCompany = new Map();

    for (const file of state.files) {
      const company = (file.company || "").trim() || "회사 미확인";
      if (!byCompany.has(company)) {
        byCompany.set(company, { company, premium: null, payback: false, cells: {} });
      }
      const entry = byCompany.get(company);
      if (Number.isFinite(file.totalPremium)) entry.premium = (entry.premium || 0) + file.totalPremium;
      if (file.payback) entry.payback = true;

      for (const item of file.items) {
        if (!item.checked || item.dailyValue === "") continue;
        const categories = categoriesOfChoice(item.choice);
        const sides = item.sideChoice === "양쪽" ? SIDES : [item.sideChoice];
        for (const category of categories) {
          entry.cells[category] = entry.cells[category] || {};
          for (const side of sides) entry.cells[category][side] = item.dailyValue;
        }
      }
    }

    for (const entry of byCompany.values()) {
      entry.cells["간병페이백"] = { 상해: entry.payback ? "o" : "x", 질병: entry.payback ? "o" : "x" };
    }
    const sortKey = (entry) => {
      const premium = premiumOf(entry);
      return Number.isFinite(premium) && premium > 0 ? premium : Number.POSITIVE_INFINITY;
    };
    return [...byCompany.values()].sort((a, b) => sortKey(a) - sortKey(b));
  }

  function valueFor(entry, category, side) {
    const key = overrideKey(entry.company, category, side);
    if (state.overrides.has(key)) return state.overrides.get(key);
    return (entry.cells[category] && entry.cells[category][side]) || "";
  }

  // 하루 입원했을 때 실제로 받는 금액을 상황별로 합산한다(체크된 담보, 보험사마다 따로 — 비교하는 제안서끼리 더하지 않는다).
  const SUMMARY_SCENARIOS = [
    { label: "일반병원 입원", parts: ["입원일당", "간병인사용일당"] },
    { label: "종합병원 입원", parts: ["입원일당", "간병인사용일당", "종합병원일당"] },
    { label: "종합병원 1인실", parts: ["입원일당", "간병인사용일당", "종합병원일당", "종합1인실"] },
    { label: "종합병원 2~3인실", parts: ["입원일당", "간병인사용일당", "종합병원일당", "종합2~3인실"] },
    { label: "종합병원 4~5인실", parts: ["입원일당", "간병인사용일당", "종합병원일당", "종합4~5인실"] },
    { label: "상급병원 1인실", parts: ["입원일당", "간병인사용일당", "상급1인실"], sanggeup: true },
    { label: "상급병원 2~3인실", parts: ["입원일당", "간병인사용일당", "상급2~3인실"], sanggeup: true },
    { label: "상급병원 4~5인실", parts: ["입원일당", "간병인사용일당", "상급4~5인실"], sanggeup: true },
    { label: "요양병원·의원", parts: ["요양병원및의원"] },
    { label: "간호간병통합서비스 병동", parts: ["입원일당", "통합간호간병"] },
  ];

  function computeSummary(matrix) {
    const addGeneral = $("sanggeupIncludesGeneral").checked;
    return SUMMARY_SCENARIOS.map((scenario) => {
      const parts = scenario.sanggeup && addGeneral ? [...scenario.parts, "종합병원일당"] : scenario.parts;
      const row = { label: scenario.label, parts, byCompany: {} };
      for (const entry of matrix) {
        const totals = { 상해: 0, 질병: 0 };
        for (const side of SIDES) {
          for (const category of parts) {
            const raw = valueFor(entry, category, side);
            if (raw === "") continue;
            const value = Number(raw);
            if (Number.isFinite(value)) totals[side] += value;
          }
          totals[side] = round(totals[side]);
        }
        row.byCompany[entry.company] = totals;
      }
      return row;
    });
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  let summaryCells = [];

  function renderMatrix() {
    const matrix = buildMatrix();
    matrixPanel.hidden = matrix.length === 0;
    matrixTable.innerHTML = "";
    summaryCells = [];
    if (matrix.length === 0) {
      $("paybackNotes").innerHTML = "";
      return;
    }

    const head = document.createElement("thead");
    const row1 = document.createElement("tr");
    const labelHead = th("항목", "row-label company-head");
    labelHead.rowSpan = 2;
    row1.appendChild(labelHead);
    for (const entry of matrix) {
      const cellTh = th(entry.company, "company-head");
      cellTh.colSpan = 2;
      row1.appendChild(cellTh);
    }
    const row2 = document.createElement("tr");
    for (const entry of matrix) {
      for (const side of SIDES) row2.appendChild(th(side, "side-head"));
    }
    head.append(row1, row2);

    const body = document.createElement("tbody");
    const onEdit = () => {
      // 표 전체를 다시 그리면 입력 중 커서가 빠지므로 합계·장점·보험료 표만 갱신
      updateSummaryCells();
      renderPremiumTable(matrix);
    };

    for (const category of state.categories) {
      const tr = document.createElement("tr");
      tr.appendChild(th(category, "row-label"));
      for (const entry of matrix) {
        for (const side of SIDES) {
          const td = document.createElement("td");
          const input = document.createElement("input");
          input.value = valueFor(entry, category, side);
          const wantsInput = Object.values(entry.cells[category] || {}).length === 0;
          if (!input.value && !wantsInput) td.classList.add("needs-input");
          input.addEventListener("input", () => {
            state.overrides.set(overrideKey(entry.company, category, side), input.value.trim());
            onEdit();
          });
          td.appendChild(input);
          tr.appendChild(td);
        }
      }
      body.appendChild(tr);
    }

    // 월 보험료: 회사당 한 칸. 바꾸면 회사 순서가 달라질 수 있어 입력을 마쳤을 때 다시 그린다.
    const premiumTr = document.createElement("tr");
    premiumTr.className = "premium-row";
    premiumTr.appendChild(th("월 보험료", "row-label"));
    for (const entry of matrix) {
      const td = document.createElement("td");
      td.colSpan = 2;
      const input = document.createElement("input");
      const premium = premiumOf(entry);
      input.value = Number.isFinite(premium) ? String(premium) : "";
      input.addEventListener("input", () => {
        state.overrides.set(overrideKey(entry.company, "보험료", "상해"), input.value.trim());
        onEdit();
      });
      input.addEventListener("change", () => renderMatrix());
      td.appendChild(input);
      premiumTr.appendChild(td);
    }
    body.appendChild(premiumTr);

    const summaryHead = document.createElement("tr");
    summaryHead.className = "summary-head";
    const summaryTitle = th("합계 — 하루 입원 시 받는 금액(만원) · 회사별");
    summaryTitle.colSpan = 1 + matrix.length * 2;
    summaryHead.appendChild(summaryTitle);
    body.appendChild(summaryHead);

    for (const scenario of SUMMARY_SCENARIOS) {
      const tr = document.createElement("tr");
      tr.className = "summary-row";
      tr.appendChild(th(scenario.label, "row-label"));
      for (const entry of matrix) {
        for (const side of SIDES) {
          const td = document.createElement("td");
          summaryCells.push({ td, tr, label: scenario.label, company: entry.company, side });
          tr.appendChild(td);
        }
      }
      body.appendChild(tr);
    }

    matrixTable.append(head, body);
    state.currentMatrix = matrix;
    updateSummaryCells();
    renderPaybackNotes();
    renderPremiumTable(matrix);
  }

  function updateSummaryCells() {
    const matrix = state.currentMatrix || buildMatrix();
    const summary = computeSummary(matrix);
    for (const cell of summaryCells) {
      const row = summary.find((s) => s.label === cell.label);
      const value = row?.byCompany[cell.company]?.[cell.side] || 0;
      cell.td.textContent = value ? String(value) : "";
      if (row) cell.tr.title = row.parts.join(" + ");
    }
    refreshAdvantages(matrix, summary);
  }

  function paybackNotes() {
    const notes = [];
    const seen = new Set();
    for (const file of state.files) {
      const note = file.paybackNote;
      if (!note || !note.text) continue;
      const company = file.company || note.company;
      if (seen.has(company)) continue;
      seen.add(company);
      notes.push({ company, text: note.text, evidence: (note.evidence || [])[0] || "" });
    }
    return notes;
  }

  function renderPaybackNotes() {
    const container = $("paybackNotes");
    container.innerHTML = "";
    const notes = paybackNotes();
    if (notes.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "제안서에서 간병인 지원금(페이백) 조건을 찾지 못했습니다. 원문을 확인해주세요.";
      container.appendChild(empty);
      return;
    }
    for (const note of notes) {
      const box = document.createElement("div");
      box.className = "payback-note";
      const title = document.createElement("strong");
      title.textContent = `${note.company} 간병 페이백`;
      const text = document.createElement("div");
      text.textContent = note.text;
      box.append(title, text);
      if (note.evidence) {
        const evidence = document.createElement("div");
        evidence.className = "evidence";
        evidence.textContent = `원문: ${note.evidence}`;
        box.appendChild(evidence);
      }
      container.appendChild(box);
    }
  }

  $("sanggeupIncludesGeneral").addEventListener("change", () => renderMatrix());

  /* ---------- 이 보험의 장점 (숫자 비교로 자동 정리, 외부 AI 사용 안 함) ---------- */

  const STRENGTHS = [
    { label: "일반병원 입원", phrase: "일반 병원에 입원해도" },
    { label: "종합병원 입원", phrase: "종합병원에 입원하면" },
    { label: "상급병원 1인실", phrase: "대학병원(상급종합병원) 1인실을 쓰면" },
    { label: "간호간병통합서비스 병동", phrase: "간호간병통합서비스 병동에 입원하면" },
    { label: "요양병원·의원", phrase: "요양병원에 입원하면" },
  ];

  // 받침에 맞는 조사(이/가).
  function iga(word) {
    const code = word.charCodeAt(word.length - 1) - 0xac00;
    return code >= 0 && code <= 11171 && code % 28 !== 0 ? "이" : "가";
  }

  const wonText = (value) => `${Number(value).toLocaleString("ko-KR")}원`;

  function buildAdvantages(matrix, summary) {
    const multi = matrix.length > 1;
    const notes = paybackNotes();
    const daily = (entry) => {
      const result = {};
      for (const category of state.categories) {
        if (category === "간병페이백") continue;
        const s = Number(valueFor(entry, category, "상해")) || 0;
        const d = Number(valueFor(entry, category, "질병")) || 0;
        if (s || d) result[category] = { 상해: s, 질병: d };
      }
      return result;
    };
    const companies = matrix.map((entry) => ({ company: entry.company, premium: premiumOf(entry), daily: daily(entry) }));
    const priced = companies.filter((c) => Number.isFinite(c.premium) && c.premium > 0);
    const cheapest = priced[0];
    const dearest = priced[priced.length - 1];
    const coverageCount = (c) => Object.keys(c.daily).length;
    const widest = [...companies].sort((a, b) => coverageCount(b) - coverageCount(a))[0];
    const has = (c, category) => Boolean(c.daily[category]);

    const blocks = companies.map((c) => {
      const points = [];
      if (multi && cheapest && dearest && c.company === cheapest.company && dearest.company !== cheapest.company) {
        points.push(`비교한 제안서 중 월 보험료가 가장 저렴합니다(월 ${wonText(c.premium)}, ${dearest.company}보다 월 ${wonText(dearest.premium - c.premium)} 적음).`);
      }
      const note = notes.find((n) => n.company === c.company);
      if (note) points.push(`간병 페이백: ${note.text}`);

      // 일반병원과 금액이 같은 상황(종합·상급 추가 보장이 없는 경우)은 같은 말을 반복하지 않는다.
      const base = summary.find((s) => s.label === "일반병원 입원")?.byCompany[c.company];
      let strengthCount = 0;
      for (const { label, phrase } of STRENGTHS) {
        const row = summary.find((s) => s.label === label);
        const mine = row?.byCompany[c.company];
        if (!row || !mine) continue;
        const sides = ["질병", "상해"].filter((side) => {
          if (!mine[side]) return false;
          if (label !== "일반병원 입원" && label !== "요양병원·의원" && base && mine[side] === base[side]) return false;
          if (!multi) return true;
          return companies.filter((o) => o.company !== c.company).every((o) => mine[side] > (row.byCompany[o.company]?.[side] || 0));
        });
        if (sides.length === 0) continue;
        const amount = sides.map((side) => `${side} ${mine[side]}만원`).join(" · ");
        points.push(multi ? `${phrase} 하루 ${amount}으로 비교한 제안서 중 가장 든든합니다.` : `${phrase} 하루 ${amount}을 받습니다.`);
        if (++strengthCount >= 3) break;
      }

      const unique = (category) => has(c, category) && (!multi || companies.every((o) => o.company === c.company || !has(o, category)));
      if (unique("간병인사용일당")) points.push("간병인을 쓰면 간병인 일당이 따로 나와 간병비 부담을 덜어줍니다.");
      if (unique("통합간호간병")) points.push("간호간병통합서비스 병동 입원 시 별도로 지급되어 보호자 간병 부담이 줄어듭니다.");
      if (SANGGEUP_ROOMS.some(unique)) points.push("대학병원 상급병실 입원비를 따로 보장해 병실료 부담을 줄여줍니다.");
      if (unique("종합병원일당")) points.push("종합병원에 입원하면 추가 일당이 더 붙습니다.");
      if (unique("요양병원및의원")) points.push("요양병원·의원 입원도 보장합니다.");
      if (points.length === 0 && multi && widest && widest.company === c.company) points.push("입원·간병 보장 항목이 가장 다양합니다.");

      if (points.length === 0) return "";
      const head = `[${c.company}]${Number.isFinite(c.premium) && c.premium > 0 ? ` 월 ${wonText(c.premium)}` : ""}`;
      return [head, ...points.slice(0, 5).map((p) => `• ${p}`)].join("\n");
    });

    let headline;
    if (!multi) {
      headline = companies[0] ? `${companies[0].company} 제안서의 입원·간병 보장 장점입니다.` : "";
    } else if (cheapest && widest && cheapest.company !== widest.company && coverageCount(widest) > coverageCount(cheapest)) {
      headline = `보험료는 ${cheapest.company}, 보장 폭은 ${widest.company}${iga(widest.company)} 강점입니다.`;
    } else if (cheapest && widest && cheapest.company === widest.company) {
      headline = `${cheapest.company}${iga(cheapest.company)} 보험료도 가장 저렴하고 입원·간병 보장 항목도 가장 다양합니다.`;
    } else if (cheapest) {
      headline = `보험료는 ${cheapest.company}${iga(cheapest.company)} 가장 저렴합니다. 보험사별 장점을 비교해 보세요.`;
    } else {
      headline = `보험사 ${companies.length}곳 제안서의 장점을 비교했습니다.`;
    }
    return [headline, ...blocks].filter(Boolean).join("\n\n");
  }

  // 직접 고치지 않았으면 숫자가 바뀔 때마다 새로 정리한다.
  function refreshAdvantages(matrix, summary) {
    const textarea = $("advantagesText");
    if (state.advantagesEdited) {
      $("advantagesSource").textContent = "(직접 수정함)";
      return;
    }
    textarea.value = buildAdvantages(matrix, summary);
    textarea.rows = Math.min(16, textarea.value.split("\n").length + 1);
    $("advantagesSource").textContent = "(숫자 비교로 자동 정리)";
  }

  $("advantagesText").addEventListener("input", () => {
    state.advantagesEdited = true;
    $("advantagesSource").textContent = "(직접 수정함)";
  });

  $("advantagesResetBtn").addEventListener("click", () => {
    state.advantagesEdited = false;
    updateSummaryCells();
  });

  function advantagesLines() {
    if (!$("includeAdvantages").checked) return [];
    return $("advantagesText").value.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  function th(text, className) {
    const element = document.createElement("th");
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  /* ---------- 탭 · 상태 바 ---------- */

  function showTab(name) {
    for (const tab of document.querySelectorAll(".tab")) {
      tab.classList.toggle("is-active", tab.dataset.tab === name);
    }
    for (const page of document.querySelectorAll(".tab-page")) {
      page.hidden = page.dataset.page !== name;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => showTab(tab.dataset.tab));
  }

  $("statusDownloadBtn").addEventListener("click", () => $("downloadSummaryBtn").click());

  function renderStatus() {
    let checked = 0;
    let total = 0;
    for (const file of state.files) {
      for (const item of file.items) {
        total++;
        if (item.checked) checked++;
      }
    }
    $("countFiles").textContent = state.files.length ? `${state.files.length}건` : "";
    $("countItems").textContent = total ? `${checked}/${total}` : "";
    $("statusBar").hidden = state.files.length === 0;
    $("statusText").textContent =
      `문서 ${state.files.length}건 · 담보 ${checked}/${total} 체크 · ` +
      (state.templateFile ? state.templateFile.name : "양식 미선택");
    $("itemsEmpty").hidden = state.files.length > 0;
    $("resultEmpty").hidden = state.files.length > 0;
  }

  /* ---------- 항목별 보험료 ---------- */

  // 담보 하나가 여러 항목(인실 3칸 등)에 들어가도 보험료는 첫 항목에만 한 번 더한다.
  function renderPremiumTable(matrix) {
    const table = $("premiumTable");
    table.innerHTML = "";
    if (matrix.length === 0) return;

    const companies = matrix.map((entry) => entry.company);
    const totals = new Map();
    for (const file of state.files) {
      const company = (file.company || "").trim() || "회사 미확인";
      for (const item of file.items) {
        if (!item.checked) continue;
        const category = categoriesOfChoice(item.choice)[0];
        if (!category) continue;
        const premium = Number(String(item.premium || "").replace(/[^\d]/g, ""));
        if (!Number.isFinite(premium) || premium === 0) continue;
        const bucket = totals.get(company) || new Map();
        bucket.set(category, (bucket.get(category) || 0) + premium);
        totals.set(company, bucket);
      }
    }

    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    headRow.appendChild(th("항목", "row-label"));
    for (const company of companies) headRow.appendChild(th(company));
    head.appendChild(headRow);

    const body = document.createElement("tbody");
    const won = (value) => (value ? `${value.toLocaleString("ko-KR")}원` : "");

    // 회사끼리 더하지 않는다 — 회사별 월 보험료와 그 담보로 하루에 받는 금액을 같이 보여준다.
    for (const category of state.categories) {
      if (category === "간병페이백") continue;
      const cells = matrix.map((entry) => {
        const premium = (totals.get(entry.company) || new Map()).get(category) || 0;
        const daily = SIDES.map((side) => [side, Number(valueFor(entry, category, side)) || 0]).filter(([, v]) => v > 0);
        return { premium, daily };
      });
      if (cells.every((c) => !c.premium && c.daily.length === 0)) continue;
      const tr = document.createElement("tr");
      tr.appendChild(th(category, "row-label"));
      for (const c of cells) {
        const td = document.createElement("td");
        const premiumLine = document.createElement("div");
        premiumLine.textContent = c.premium ? `월 ${won(c.premium)}` : c.daily.length ? "보험료 확인 필요" : "";
        td.appendChild(premiumLine);
        if (c.daily.length) {
          const dailyLine = document.createElement("div");
          dailyLine.className = "daily-line";
          dailyLine.textContent = `1일당 ${c.daily.map(([side, v]) => `${side} ${v}만원`).join(" · ")}`;
          td.appendChild(dailyLine);
        }
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }

    const totalRow = document.createElement("tr");
    totalRow.appendChild(th("체크한 담보 보험료", "row-label"));
    for (const company of companies) {
      const bucket = totals.get(company) || new Map();
      const sum = [...bucket.values()].reduce((a, b) => a + b, 0);
      const td = document.createElement("td");
      td.textContent = sum ? `월 ${won(sum)}` : "";
      totalRow.appendChild(td);
    }
    body.appendChild(totalRow);

    table.append(head, body);
  }

  function renderAll() {
    renderFiles();
    renderItems();
    renderMatrix();
    renderPending();
    renderStatus();
  }

  /* ---------- 내려받기 ---------- */

  $("checkAllBtn").addEventListener("click", () => {
    for (const file of state.files) {
      for (const item of file.items) {
        if (categoriesOfChoice(item.choice).length > 0) item.checked = true;
      }
    }
    renderAll();
  });

  $("uncheckAllBtn").addEventListener("click", () => {
    for (const file of state.files) for (const item of file.items) item.checked = false;
    renderAll();
  });

  $("templatePickBtn").addEventListener("click", () => $("templateInput").click());
  $("templateInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    state.templateFile = file || null;
    state.templateSheet = "";
    const sheetSelect = $("sheetSelect");
    if (sheetSelect) sheetSelect.remove();
    $("templateName").textContent = file ? file.name : "선택된 양식 없음";
    renderStatus();
    if (!file) return;

    // 양식 안에 담보표 시트가 여러 개일 수 있어(사본 시트 등) 어디에 채울지 고르게 한다.
    try {
      const formData = new FormData();
      formData.append("template", file);
      const response = await fetch("/api/template-info", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "양식을 읽지 못했습니다.");

      const sheets = data.sheets || [];
      if (sheets.length === 0) throw new Error("양식에서 '회사명' 칸이 있는 시트를 찾지 못했습니다.");
      state.templateSheet = sheets[0].name;

      const detail = document.createElement("span");
      detail.className = "muted";
      detail.id = "sheetSelect";
      if (sheets.length === 1) {
        const companies = sheets[0].companies.join(", ");
        detail.textContent = `시트 "${sheets[0].name}"${companies ? ` · 이미 있는 회사: ${companies}` : ""}`;
      } else {
        const select = document.createElement("select");
        for (const sheet of sheets) {
          const option = document.createElement("option");
          option.value = sheet.name;
          option.textContent = `${sheet.name}${sheet.companies.length ? ` (${sheet.companies.join(", ")})` : " (비어 있음)"}`;
          select.appendChild(option);
        }
        select.addEventListener("change", () => {
          state.templateSheet = select.value;
        });
        detail.append("채울 시트: ", select);
      }
      document.querySelector(".template-row").appendChild(detail);
    } catch (error) {
      showError(resultError, error.message);
    }
  });

  $("resetBtn").addEventListener("click", () => {
    state.files = [];
    state.pending = [];
    state.overrides.clear();
    state.advantagesEdited = false;
    showError(resultError, "");
    showError(uploadError, "");
    renderAll();
  });

  function download(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function fileNameFrom(response, fallback) {
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/);
    return match ? decodeURIComponent(match[1]) : fallback;
  }

  // 화면 값(직접 수정 포함)을 엑셀용 회사별 표로. 순서는 보험료 낮은 순.
  function exportMatrix(matrix) {
    return matrix.map((entry) => {
      const cells = {};
      for (const category of state.categories) {
        const values = {};
        for (const side of SIDES) {
          const raw = valueFor(entry, category, side);
          if (raw === "") continue;
          values[side] = category === "간병페이백" || Number.isNaN(Number(raw)) ? raw : Number(raw);
        }
        if (Object.keys(values).length > 0) cells[category] = values;
      }
      const premium = premiumOf(entry);
      return { company: entry.company, premium: Number.isFinite(premium) ? premium : null, cells };
    });
  }

  function exportExtras(matrix) {
    return {
      summary: computeSummary(matrix).map((row) => ({ label: row.label, byCompany: row.byCompany })),
      paybackNotes: paybackNotes().map((note) => ({ company: note.company, text: note.text })),
      summaryLines: advantagesLines(),
    };
  }

  $("downloadTemplateBtn").addEventListener("click", async () => {
    showError(resultError, "");
    if (!state.templateFile) {
      showError(resultError, "먼저 엑셀 양식 파일(.xlsx)을 선택해주세요.");
      return;
    }
    const matrix = buildMatrix();
    const formData = new FormData();
    formData.append("template", state.templateFile);
    formData.append("matrix", JSON.stringify(exportMatrix(matrix)));
    formData.append("sheetName", state.templateSheet || "");
    formData.append("extras", JSON.stringify(exportExtras(matrix)));

    try {
      const response = await fetch("/api/export-template", { method: "POST", body: formData });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "양식을 채우는 중 오류가 발생했습니다.");
      }
      const skipped = response.headers.get("X-Skipped-Companies");
      const blob = await response.blob();
      download(blob, fileNameFrom(response, "담보정리.xlsx"));
      if (skipped) {
        showError(resultError, `양식에 빈 회사 칸이 모자라 넣지 못한 회사: ${decodeURIComponent(skipped)}`);
      }
    } catch (error) {
      showError(resultError, error.message);
    }
  });

  $("downloadSummaryBtn").addEventListener("click", async () => {
    showError(resultError, "");
    const matrix = buildMatrix();
    if (matrix.length === 0) {
      showError(resultError, "엑셀에 넣을 내용이 없습니다. 문서를 올리고 담보를 체크해주세요.");
      return;
    }
    const order = new Map(matrix.map((entry, index) => [entry.company, index]));
    const rows = [];
    for (const file of state.files) {
      const company = (file.company || "").trim() || "회사 미확인";
      for (const item of file.items) {
        if (!item.checked) continue;
        rows.push({ company, coverageName: item.coverageName, amount: item.amount, term: item.term, premium: item.premium });
      }
    }
    rows.sort((a, b) => (order.get(a.company) ?? 99) - (order.get(b.company) ?? 99));

    try {
      const response = await fetch("/api/export-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matrix: exportMatrix(matrix), categories: state.categories, rows, ...exportExtras(matrix) }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "엑셀을 만드는 중 오류가 발생했습니다.");
      }
      const blob = await response.blob();
      download(blob, fileNameFrom(response, "가입제안서_담보정리.xlsx"));
    } catch (error) {
      showError(resultError, error.message);
    }
  });

  /* ---------- 시작 ---------- */

  fetch("/api/categories")
    .then((response) => response.json())
    .then((data) => {
      state.categories = data.categories || [];
      renderAll();
    })
    .catch(() => {
      showError(uploadError, "서버와 연결하지 못했습니다. 서버가 실행 중인지 확인해주세요.");
    });
})();
