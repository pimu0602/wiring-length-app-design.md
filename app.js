const STORAGE_KEY = "wiring-length-app-v1";
const ROUTE_COLORS = ["#13795b", "#1d5f8f", "#a15c08", "#7f4aa3", "#a9332f"];

const elements = {
  pdfInput: document.getElementById("pdfInput"),
  pdfFrame: document.getElementById("pdfFrame"),
  emptyState: document.getElementById("emptyState"),
  overlay: document.getElementById("routeOverlay"),
  pageInput: document.getElementById("pageInput"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  zoomOutBtn: document.getElementById("zoomOutBtn"),
  zoomInBtn: document.getElementById("zoomInBtn"),
  zoomLabel: document.getElementById("zoomLabel"),
  deletePointBtn: document.getElementById("deletePointBtn"),
  routeNameInput: document.getElementById("routeNameInput"),
  extraLengthInput: document.getElementById("extraLengthInput"),
  roundingUnitInput: document.getElementById("roundingUnitInput"),
  newRouteBtn: document.getElementById("newRouteBtn"),
  confirmRouteBtn: document.getElementById("confirmRouteBtn"),
  resetRouteBtn: document.getElementById("resetRouteBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  pointCount: document.getElementById("pointCount"),
  segmentCount: document.getElementById("segmentCount"),
  routeState: document.getElementById("routeState"),
  segmentTableBody: document.getElementById("segmentTableBody"),
  routeTableBody: document.getElementById("routeTableBody"),
  totalSegmentLength: document.getElementById("totalSegmentLength"),
  extraLengthResult: document.getElementById("extraLengthResult"),
  totalLength: document.getElementById("totalLength"),
  recommendedCutLength: document.getElementById("recommendedCutLength"),
  recommendedCutLengthM: document.getElementById("recommendedCutLengthM"),
  storageStatus: document.getElementById("storageStatus"),
};

const state = {
  pdfUrl: "",
  pdfName: "",
  currentPage: 1,
  zoom: 100,
  routes: [],
  activeRouteId: "",
  selectedPointId: "",
};

let draggingPointId = "";
let pointerMoved = false;

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getActiveRoute() {
  return state.routes.find((route) => route.id === state.activeRouteId);
}

function getPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function getNonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function createRoute() {
  const route = {
    id: uid("route"),
    name: elements.routeNameInput.value.trim() || `配線ルート${state.routes.length + 1}`,
    points: [],
    segments: [],
    extraLengthMm: getNonNegativeNumber(elements.extraLengthInput.value, 300),
    roundingUnitMm: getPositiveNumber(elements.roundingUnitInput.value, 100),
    totalSegmentLengthMm: 0,
    totalLengthMm: 0,
    recommendedCutLengthMm: 0,
    confirmed: false,
    createdAt: new Date().toISOString(),
  };

  state.routes.push(route);
  state.activeRouteId = route.id;
  state.selectedPointId = "";
  syncInputsFromRoute(route);
  saveState();
  render();
}

function syncRouteFromInputs(route) {
  if (!route) return;
  route.name = elements.routeNameInput.value.trim() || route.name || "無題の配線";
  route.extraLengthMm = getNonNegativeNumber(elements.extraLengthInput.value, 0);
  route.roundingUnitMm = getPositiveNumber(elements.roundingUnitInput.value, 100);
  recalculateRoute(route);
}

function syncInputsFromRoute(route) {
  if (!route) return;
  elements.routeNameInput.value = route.name || "";
  elements.extraLengthInput.value = route.extraLengthMm ?? 300;
  elements.roundingUnitInput.value = route.roundingUnitMm ?? 100;
}

function updatePdfFrame() {
  if (!state.pdfUrl) {
    elements.pdfFrame.removeAttribute("src");
    elements.emptyState.hidden = false;
    return;
  }

  const page = Math.max(1, Number(state.currentPage) || 1);
  const zoom = clamp(Number(state.zoom) || 100, 50, 200);
  elements.pdfFrame.src = `${state.pdfUrl}#page=${page}&zoom=${zoom}`;
  elements.emptyState.hidden = true;
  elements.pageInput.value = page;
  elements.zoomLabel.textContent = `${zoom}%`;
}

function addPoint(clientX, clientY) {
  let route = getActiveRoute();
  if (!route) {
    createRoute();
    route = getActiveRoute();
  }

  const point = pointerToPoint(clientX, clientY);
  route.points.push({
    id: uid("point"),
    x: point.x,
    y: point.y,
    page: state.currentPage,
  });
  route.confirmed = false;
  recalculateRoute(route);
  saveState();
  render();
}

function pointerToPoint(clientX, clientY) {
  const rect = elements.overlay.getBoundingClientRect();
  return {
    x: clamp((clientX - rect.left) / rect.width, 0, 1),
    y: clamp((clientY - rect.top) / rect.height, 0, 1),
  };
}

function movePoint(pointId, clientX, clientY) {
  const route = getActiveRoute();
  if (!route) return;
  const point = route.points.find((item) => item.id === pointId);
  if (!point) return;

  const next = pointerToPoint(clientX, clientY);
  point.x = next.x;
  point.y = next.y;
  point.page = state.currentPage;
  recalculateRoute(route);
  render();
}

function deletePoint(pointId) {
  const route = getActiveRoute();
  if (!route) return;
  route.points = route.points.filter((point) => point.id !== pointId);
  if (state.selectedPointId === pointId) {
    state.selectedPointId = "";
  }
  route.confirmed = false;
  recalculateRoute(route);
  saveState();
  render();
}

function recalculateRoute(route) {
  route.segments = buildSegments(route);
  route.totalSegmentLengthMm = route.segments.reduce((sum, segment) => sum + segment.selectedLengthMm, 0);
  route.totalLengthMm = route.totalSegmentLengthMm + route.extraLengthMm;
  route.recommendedCutLengthMm = roundUp(route.totalLengthMm, route.roundingUnitMm);
}

function buildSegments(route) {
  const existing = new Map(route.segments.map((segment) => [`${segment.fromPointId}:${segment.toPointId}`, segment]));
  const nextSegments = [];

  for (let index = 0; index < route.points.length - 1; index += 1) {
    const from = route.points[index];
    const to = route.points[index + 1];
    const key = `${from.id}:${to.id}`;
    const previous = existing.get(key);
    const autoLengthMm = calculateAutoLength(from, to);
    const manualLengthMm = previous?.manualLengthMm;
    const hasManual = Number.isFinite(manualLengthMm);

    nextSegments.push({
      id: previous?.id || uid("segment"),
      fromPointId: from.id,
      toPointId: to.id,
      autoLengthMm,
      manualLengthMm: hasManual ? manualLengthMm : undefined,
      selectedLengthMm: hasManual ? manualLengthMm : autoLengthMm,
      inputMethod: hasManual ? "manual" : "auto",
    });
  }

  return nextSegments;
}

function calculateAutoLength(from, to) {
  if (from.page !== to.page) return 0;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.round(Math.sqrt(dx * dx + dy * dy) * 1000);
}

function roundUp(value, unit) {
  if (!unit) return value;
  return Math.ceil(value / unit) * unit;
}

function render() {
  updatePdfFrame();
  renderOverlay();
  renderSegments();
  renderResults();
  renderRoutes();
  renderMeta();
}

function renderOverlay() {
  const svg = elements.overlay;
  svg.textContent = "";

  state.routes.forEach((route, routeIndex) => {
    const color = ROUTE_COLORS[routeIndex % ROUTE_COLORS.length];
    renderRouteLines(route, color);
    renderRoutePoints(route, color);
  });

  elements.deletePointBtn.disabled = !state.selectedPointId;
}

function renderRouteLines(route, color) {
  route.segments.forEach((segment) => {
    const from = route.points.find((point) => point.id === segment.fromPointId);
    const to = route.points.find((point) => point.id === segment.toPointId);
    if (!from || !to || from.page !== state.currentPage || to.page !== state.currentPage) return;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", `${from.x * 100}%`);
    line.setAttribute("y1", `${from.y * 100}%`);
    line.setAttribute("x2", `${to.x * 100}%`);
    line.setAttribute("y2", `${to.y * 100}%`);
    line.setAttribute("class", "overlay-line");
    line.setAttribute("stroke", color);
    elements.overlay.appendChild(line);
  });
}

function renderRoutePoints(route, color) {
  route.points.forEach((point, index) => {
    if (point.page !== state.currentPage) return;

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", `${point.x * 100}%`);
    circle.setAttribute("cy", `${point.y * 100}%`);
    circle.setAttribute("r", route.id === state.activeRouteId ? "8" : "6");
    circle.setAttribute("fill", color);
    circle.setAttribute("class", point.id === state.selectedPointId ? "overlay-point selected" : "overlay-point");
    circle.dataset.pointId = point.id;
    circle.dataset.routeId = route.id;
    elements.overlay.appendChild(circle);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", `${point.x * 100}%`);
    label.setAttribute("y", `${point.y * 100}%`);
    label.setAttribute("dx", "11");
    label.setAttribute("dy", "-11");
    label.setAttribute("class", "overlay-label");
    label.textContent = `点${index + 1}`;
    elements.overlay.appendChild(label);
  });
}

function renderSegments() {
  const route = getActiveRoute();
  if (!route || route.segments.length === 0) {
    elements.segmentTableBody.innerHTML = `<tr><td colspan="6" class="empty-row">区間はまだありません</td></tr>`;
    return;
  }

  elements.segmentTableBody.innerHTML = "";
  route.segments.forEach((segment, index) => {
    const fromIndex = route.points.findIndex((point) => point.id === segment.fromPointId) + 1;
    const toIndex = route.points.findIndex((point) => point.id === segment.toPointId) + 1;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>区間${index + 1}</td>
      <td>点${fromIndex}</td>
      <td>点${toIndex}</td>
      <td>${segment.autoLengthMm}</td>
      <td><input type="number" min="0" step="10" value="${segment.selectedLengthMm}" data-segment-id="${segment.id}" aria-label="区間${index + 1}の採用長"></td>
      <td>${segment.inputMethod === "manual" ? "手入力" : "自動"}</td>
    `;
    elements.segmentTableBody.appendChild(row);
  });
}

function renderResults() {
  const route = getActiveRoute();
  const totalSegment = route?.totalSegmentLengthMm || 0;
  const extra = route?.extraLengthMm ?? getNonNegativeNumber(elements.extraLengthInput.value, 300);
  const total = route?.totalLengthMm ?? extra;
  const recommended = route?.recommendedCutLengthMm ?? roundUp(total, getPositiveNumber(elements.roundingUnitInput.value, 100));

  elements.totalSegmentLength.textContent = totalSegment;
  elements.extraLengthResult.textContent = extra;
  elements.totalLength.textContent = total;
  elements.recommendedCutLength.textContent = recommended;
  elements.recommendedCutLengthM.textContent = formatMeters(recommended);
}

function renderRoutes() {
  const validRoutes = state.routes.filter((route) => route.points.length >= 2);
  if (validRoutes.length === 0) {
    elements.routeTableBody.innerHTML = `<tr><td colspan="4" class="empty-row">保存済みルートはありません</td></tr>`;
    return;
  }

  elements.routeTableBody.innerHTML = "";
  validRoutes.forEach((route) => {
    const row = document.createElement("tr");
    row.className = route.id === state.activeRouteId ? "route-row active" : "route-row";
    row.dataset.routeId = route.id;
    row.innerHTML = `
      <td>${escapeHtml(route.name)}</td>
      <td>${route.segments.length}</td>
      <td>${route.totalLengthMm}</td>
      <td>${formatMeters(route.recommendedCutLengthMm)} m</td>
    `;
    elements.routeTableBody.appendChild(row);
  });
}

function renderMeta() {
  const route = getActiveRoute();
  elements.pointCount.textContent = route?.points.length || 0;
  elements.segmentCount.textContent = route?.segments.length || 0;
  elements.routeState.textContent = route ? (route.confirmed ? "確定済み" : "編集中") : "未作成";
}

function formatMeters(mm) {
  return (mm / 1000).toLocaleString("ja-JP", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function saveState() {
  const data = {
    pdfName: state.pdfName,
    currentPage: state.currentPage,
    zoom: state.zoom,
    routes: state.routes,
    activeRouteId: state.activeRouteId,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  elements.storageStatus.textContent = "ローカル保存: 保存済み";
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const data = JSON.parse(raw);
    state.pdfName = data.pdfName || "";
    state.currentPage = data.currentPage || 1;
    state.zoom = data.zoom || 100;
    state.routes = Array.isArray(data.routes) ? data.routes : [];
    state.activeRouteId = data.activeRouteId || state.routes[0]?.id || "";
    state.routes.forEach(recalculateRoute);
    const route = getActiveRoute();
    if (route) syncInputsFromRoute(route);
    elements.storageStatus.textContent = "ローカル保存: 復元済み";
  } catch {
    elements.storageStatus.textContent = "ローカル保存: 復元失敗";
  }
}

function exportCsv() {
  const rows = state.routes
    .filter((route) => route.points.length >= 2)
    .map((route) => [
      route.name,
      route.segments.length,
      route.totalSegmentLengthMm,
      route.extraLengthMm,
      route.totalLengthMm,
      route.recommendedCutLengthMm,
      formatMeters(route.recommendedCutLengthMm),
    ]);

  const header = ["配線名", "区間数", "区間長合計mm", "余長mm", "合計長mm", "推奨カット長mm", "推奨カット長m"];
  const csv = [header, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "wiring-cut-list.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function toCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

elements.pdfInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
  state.pdfUrl = URL.createObjectURL(file);
  state.pdfName = file.name;
  state.currentPage = 1;
  saveState();
  render();
});

elements.prevPageBtn.addEventListener("click", () => {
  state.currentPage = Math.max(1, state.currentPage - 1);
  saveState();
  render();
});

elements.nextPageBtn.addEventListener("click", () => {
  state.currentPage += 1;
  saveState();
  render();
});

elements.pageInput.addEventListener("change", () => {
  state.currentPage = Math.max(1, Number(elements.pageInput.value) || 1);
  saveState();
  render();
});

elements.zoomOutBtn.addEventListener("click", () => {
  state.zoom = clamp(state.zoom - 10, 50, 200);
  saveState();
  render();
});

elements.zoomInBtn.addEventListener("click", () => {
  state.zoom = clamp(state.zoom + 10, 50, 200);
  saveState();
  render();
});

elements.newRouteBtn.addEventListener("click", createRoute);

elements.confirmRouteBtn.addEventListener("click", () => {
  const route = getActiveRoute();
  if (!route || route.points.length < 2) {
    alert("ルート確定には2点以上が必要です。");
    return;
  }
  syncRouteFromInputs(route);
  route.confirmed = true;
  saveState();
  render();
});

elements.resetRouteBtn.addEventListener("click", () => {
  const route = getActiveRoute();
  if (!route) return;
  route.points = [];
  route.segments = [];
  route.confirmed = false;
  state.selectedPointId = "";
  recalculateRoute(route);
  saveState();
  render();
});

elements.exportCsvBtn.addEventListener("click", exportCsv);

elements.deletePointBtn.addEventListener("click", () => {
  if (state.selectedPointId) deletePoint(state.selectedPointId);
});

[elements.routeNameInput, elements.extraLengthInput, elements.roundingUnitInput].forEach((input) => {
  input.addEventListener("input", () => {
    const route = getActiveRoute();
    syncRouteFromInputs(route);
    saveState();
    render();
  });
});

elements.segmentTableBody.addEventListener("input", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const route = getActiveRoute();
  if (!route) return;
  const segment = route.segments.find((item) => item.id === input.dataset.segmentId);
  if (!segment) return;

  const value = getNonNegativeNumber(input.value, segment.autoLengthMm);
  segment.manualLengthMm = value;
  segment.selectedLengthMm = value;
  segment.inputMethod = "manual";
  recalculateRoute(route);
  saveState();
  renderResults();
  renderRoutes();
});

elements.routeTableBody.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-route-id]");
  if (!row) return;
  state.activeRouteId = row.dataset.routeId;
  state.selectedPointId = "";
  syncInputsFromRoute(getActiveRoute());
  saveState();
  render();
});

elements.overlay.addEventListener("pointerdown", (event) => {
  const pointId = event.target.dataset?.pointId;
  const routeId = event.target.dataset?.routeId;
  if (!pointId || !routeId) return;

  state.activeRouteId = routeId;
  state.selectedPointId = pointId;
  draggingPointId = pointId;
  pointerMoved = false;
  syncInputsFromRoute(getActiveRoute());
  elements.overlay.setPointerCapture(event.pointerId);
  render();
});

elements.overlay.addEventListener("pointermove", (event) => {
  if (!draggingPointId) return;
  pointerMoved = true;
  movePoint(draggingPointId, event.clientX, event.clientY);
});

elements.overlay.addEventListener("pointerup", (event) => {
  if (draggingPointId) {
    saveState();
    draggingPointId = "";
    try {
      elements.overlay.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    return;
  }
});

elements.overlay.addEventListener("click", (event) => {
  if (event.target.dataset?.pointId || pointerMoved) {
    pointerMoved = false;
    return;
  }
  addPoint(event.clientX, event.clientY);
});

elements.overlay.addEventListener("contextmenu", (event) => {
  const pointId = event.target.dataset?.pointId;
  if (!pointId) return;
  event.preventDefault();
  deletePoint(pointId);
});

window.addEventListener("beforeunload", () => {
  if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
});

loadState();
render();
