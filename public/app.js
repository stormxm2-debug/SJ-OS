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
      const group = document.createElement("div");
      group.className = "item-group";
      const title = document.createElement("h3");
      title.textContent = `${file.company || "회사 미확인"} — ${file.fileName}`;
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

  /* ---------- 양식 미리보기 ---------- */

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
    return [...byCompany.values()];
  }

  function valueFor(entry, category, side) {
    const key = overrideKey(entry.company, category, side);
    if (state.overrides.has(key)) return state.overrides.get(key);
    return (entry.cells[category] && entry.cells[category][side]) || "";
  }

  function renderMatrix() {
    const matrix = buildMatrix();
    matrixPanel.hidden = matrix.length === 0;
    matrixTable.innerHTML = "";
    if (matrix.length === 0) return;

    const head = document.createElement("thead");
    const row1 = document.createElement("tr");
    row1.appendChild(th("항목", "row-label"));
    for (const entry of matrix) {
      const cellTh = th(entry.company);
      cellTh.colSpan = 2;
      row1.appendChild(cellTh);
    }
    const row2 = document.createElement("tr");
    row2.appendChild(th("", "row-label"));
    for (const entry of matrix) {
      for (const side of SIDES) row2.appendChild(th(side, "side-head"));
    }
    head.append(row1, row2);

    const body = document.createElement("tbody");
    for (const category of [...state.categories, "보험료"]) {
      const tr = document.createElement("tr");
      tr.appendChild(th(category, "row-label"));
      for (const entry of matrix) {
        for (const side of SIDES) {
          const td = document.createElement("td");
          const input = document.createElement("input");
          if (category === "보험료") {
            const key = overrideKey(entry.company, "보험료", side);
            input.value = state.overrides.has(key)
              ? state.overrides.get(key)
              : Number.isFinite(entry.premium)
                ? String(entry.premium)
                : "";
          } else {
            input.value = valueFor(entry, category, side);
            const wantsInput = Object.values(entry.cells[category] || {}).length === 0;
            if (!input.value && !wantsInput) td.classList.add("needs-input");
          }
          input.addEventListener("input", () => {
            state.overrides.set(overrideKey(entry.company, category, side), input.value.trim());
          });
          td.appendChild(input);
          tr.appendChild(td);
        }
      }
      body.appendChild(tr);
    }

    matrixTable.append(head, body);
  }

  function th(text, className) {
    const element = document.createElement("th");
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function renderAll() {
    renderFiles();
    renderItems();
    renderMatrix();
    renderPending();
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
  $("templateInput").addEventListener("change", (event) => {
    const file = event.target.files[0];
    state.templateFile = file || null;
    $("templateName").textContent = file ? file.name : "선택된 양식 없음";
  });

  $("resetBtn").addEventListener("click", () => {
    state.files = [];
    state.pending = [];
    state.overrides.clear();
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
    URL.revokeObjectURL(url);
  }

  function fileNameFrom(response, fallback) {
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/);
    return match ? decodeURIComponent(match[1]) : fallback;
  }

  $("downloadTemplateBtn").addEventListener("click", async () => {
    showError(resultError, "");
    if (!state.templateFile) {
      showError(resultError, "먼저 엑셀 양식 파일(.xlsx)을 선택해주세요.");
      return;
    }
    const matrix = buildMatrix().map((entry) => {
      const cells = {};
      for (const category of [...state.categories]) {
        const values = {};
        for (const side of SIDES) {
          const raw = valueFor(entry, category, side);
          if (raw === "") continue;
          values[side] = category === "간병페이백" || Number.isNaN(Number(raw)) ? raw : Number(raw);
        }
        if (Object.keys(values).length > 0) cells[category] = values;
      }
      const premiumKey = overrideKey(entry.company, "보험료", "상해");
      const premiumRaw = state.overrides.has(premiumKey) ? state.overrides.get(premiumKey) : entry.premium;
      const premium = Number(premiumRaw);
      return { company: entry.company, premium: Number.isFinite(premium) ? premium : null, cells };
    });

    const formData = new FormData();
    formData.append("template", state.templateFile);
    formData.append("matrix", JSON.stringify(matrix));

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

  $("downloadListBtn").addEventListener("click", async () => {
    showError(resultError, "");
    const rows = [];
    for (const file of state.files) {
      for (const item of file.items) {
        if (!item.checked) continue;
        rows.push({
          coverageName: item.coverageName,
          amount: item.amount,
          term: item.term,
          premium: item.premium,
        });
      }
    }
    if (rows.length === 0) {
      showError(resultError, "체크된 담보가 없습니다.");
      return;
    }
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
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
