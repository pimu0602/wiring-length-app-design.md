const STORAGE_KEY = "wiring-length-app-v2";
const LEGACY_STORAGE_KEY = "wiring-length-app-v1";
const ROUTE_COLORS = ["#c4312f", "#13795b", "#a15c08", "#7f4aa3", "#1d5f8f"];
const PAGE_BASE_WIDTH = 900;
const PAGE_BASE_HEIGHT = 1273;
const MIN_ZOOM = 40;
const MAX_ZOOM = 260;

const MODES = {
  ROUTE: "route",
  CALIBRATION: "calibration",
  EDIT: "edit",
};

const elements = {
  pdfInput: document.getElementById("pdfInput"),
  pdfStage: document.getElementById("pdfStage"),
  pdfPage: document.getElementById("pdfPage"),
  pdfFrame: document.getElementById("pdfFrame"),
  emptyState: document.getElementById("emptyState"),
  overlay: document.getElementById("routeOverlay"),
  pageInput: document.getElementById("pageInput"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  zoomOutBtn: document.getElementById("zoomOutBtn"),
  zoomInBtn: document.getElementById("zoomInBtn"),
  fitWidthBtn: document.getElementById("fitWidthBtn"),
  fitPageBtn: document.getElementById("fitPageBtn"),
  zoomLabel: document.getElementById("zoomLabel"),
  modeSelect: document.getElementById("modeSelect"),
  deletePointBtn: document.getElementById("deletePointBtn"),
  routeNameInput: document.getElementById("routeNameInput"),
  extraLengthInput: document.getElementById("extraLengthInput"),
  roundingUnitInput: document.getElementById("roundingUnitInput"),
  newRouteBtn: document.getElementById("newRouteBtn"),
  confirmRouteBtn: document.getElementById("confirmRouteBtn"),
  calibrationModeBtn: document.getElementById("calibrationModeBtn"),
  resetCalibrationBtn: document.getElementById("resetCalibrationBtn"),
  resetRouteBtn: document.getElementById("resetRouteBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  calibrationStatus: document.getElementById("calibrationStatus"),
  calibrationPixelDistance: document.getElementById("calibrationPixelDistance"),
  calibrationScale: document.getElementById("calibrationScale"),
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
  pdfFrameSrc: "",
  currentPage: 1,
  zoom: 100,
  mode: MODES.ROUTE,
  calibration: null,
  pendingCalibrationPoint: null,
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
  state.mode = MODES.ROUTE;
  syncInputsFromRoute(route);
  render();
  saveState();
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

function render() {
  renderMode();
  renderPdfLayer();
  updateCalibrationScale();
  recalculateAllRoutes();
  renderOverlay();
  renderSegments();
  renderResults();
  renderRoutes();
  renderMeta();
}

function renderMode() {
  elements.modeSelect.value = state.mode;
}

function renderPdfLayer() {
  const hasPdf = Boolean(state.pdfUrl);
  elements.pdfPage.hidden = !hasPdf;
  setEmptyStateVisible(!hasPdf);
  renderPdfPageSize();

  if (!hasPdf) {
    elements.pdfFrame.removeAttribute("src");
    state.pdfFrameSrc = "";
    return;
  }

  const page = Math.max(1, Number(state.currentPage) || 1);
  const nextSrc = `${state.pdfUrl}#page=${page}&toolbar=0&navpanes=0&scrollbar=0&view=Fit`;
  if (state.pdfFrameSrc !== nextSrc) {
    elements.pdfFrame.src = nextSrc;
    state.pdfFrameSrc = nextSrc;
  }
  elements.pageInput.value = page;
  elements.zoomLabel.textContent = `${state.zoom}%`;
}

function renderPdfPageSize() {
  const width = Math.round(PAGE_BASE_WIDTH * (state.zoom / 100));
  const height = Math.round(PAGE_BASE_HEIGHT * (state.zoom / 100));
  elements.pdfPage.style.width = `${width}px`;
  elements.pdfPage.style.height = `${height}px`;
}

function setEmptyStateVisible(isVisible) {
  elements.emptyState.hidden = !isVisible;
  elements.emptyState.setAttribute("aria-hidden", String(!isVisible));
}

function setMode(mode) {
  state.mode = mode;
  if (mode !== MODES.CALIBRATION) {
    state.pendingCalibrationPoint = null;
  }
  render();
  saveState();
}

function setZoom(nextZoom, anchorEvent) {
  const stage = elements.pdfStage;
  const oldSize = getPageSize();
  let anchorXRatio = 0.5;
  let anchorYRatio = 0.5;

  if (anchorEvent) {
    const pageRect = elements.pdfPage.getBoundingClientRect();
    anchorXRatio = clamp((anchorEvent.clientX - pageRect.left) / pageRect.width, 0, 1);
    anchorYRatio = clamp((anchorEvent.clientY - pageRect.top) / pageRect.height, 0, 1);
  }

  state.zoom = clamp(Math.round(nextZoom), MIN_ZOOM, MAX_ZOOM);
  render();

  const newSize = getPageSize();
  stage.scrollLeft += (newSize.width - oldSize.width) * anchorXRatio;
  stage.scrollTop += (newSize.height - oldSize.height) * anchorYRatio;
  saveState();
}

function fitWidth() {
  const availableWidth = Math.max(320, elements.pdfStage.clientWidth - 48);
  setZoom((availableWidth / PAGE_BASE_WIDTH) * 100);
}

function fitPage() {
  const availableWidth = Math.max(320, elements.pdfStage.clientWidth - 48);
  const availableHeight = Math.max(320, elements.pdfStage.clientHeight - 48);
  setZoom(Math.min(availableWidth / PAGE_BASE_WIDTH, availableHeight / PAGE_BASE_HEIGHT) * 100);
}

function getPageSize() {
  return {
    width: elements.pdfPage.offsetWidth || PAGE_BASE_WIDTH,
    height: elements.pdfPage.offsetHeight || PAGE_BASE_HEIGHT,
  };
}

function pointerToPagePoint(clientX, clientY) {
  const rect = elements.pdfPage.getBoundingClientRect();
  return {
    xRatio: clamp((clientX - rect.left) / rect.width, 0, 1),
    yRatio: clamp((clientY - rect.top) / rect.height, 0, 1),
    page: state.currentPage,
  };
}

function addRoutePoint(clientX, clientY) {
  let route = getActiveRoute();
  if (!route) {
    createRoute();
    route = getActiveRoute();
  }

  const point = pointerToPagePoint(clientX, clientY);
  route.points.push({
    id: uid("point"),
    page: point.page,
    xRatio: point.xRatio,
    yRatio: point.yRatio,
  });
  route.confirmed = false;
  recalculateRoute(route);
  render();
  saveState();
}

function movePoint(pointId, clientX, clientY) {
  const route = getActiveRoute();
  if (!route) return;
  const point = route.points.find((item) => item.id === pointId);
  if (!point) return;

  const next = pointerToPagePoint(clientX, clientY);
  point.xRatio = next.xRatio;
  point.yRatio = next.yRatio;
  point.page = next.page;
  route.confirmed = false;
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
  render();
  saveState();
}

function handleCalibrationClick(clientX, clientY) {
  const clickedPoint = pointerToPagePoint(clientX, clientY);
  if (!state.pendingCalibrationPoint) {
    state.pendingCalibrationPoint = clickedPoint;
    render();
    return;
  }

  if (state.pendingCalibrationPoint.page !== clickedPoint.page) {
    state.pendingCalibrationPoint = clickedPoint;
    render();
    alert("基準寸法の始点と終点は同じページ上で指定してください。始点を取り直しました。");
    return;
  }

  const actualLengthText = prompt("基準寸法の実寸をmmで入力してください。例: 1500");
  const actualLengthMm = Number(actualLengthText);
  if (!Number.isFinite(actualLengthMm) || actualLengthMm <= 0) {
    alert("1以上の数値をmmで入力してください。");
    return;
  }

  const calibration = {
    id: uid("calibration"),
    page: clickedPoint.page,
    startPoint: state.pendingCalibrationPoint,
    endPoint: clickedPoint,
    pixelDistance: 0,
    actualLengthMm,
    mmPerPixel: 0,
  };

  state.calibration = calibration;
  state.pendingCalibrationPoint = null;
  state.mode = MODES.ROUTE;
  updateCalibrationScale();
  render();
  saveState();
}

function resetCalibration() {
  state.calibration = null;
  state.pendingCalibrationPoint = null;
  recalculateAllRoutes();
  render();
  saveState();
}

function updateCalibrationScale() {
  if (!state.calibration) return;
  const pixelDistance = calculatePixelDistance(state.calibration.startPoint, state.calibration.endPoint);
  state.calibration.pixelDistance = Math.round(pixelDistance * 100) / 100;
  state.calibration.mmPerPixel = pixelDistance > 0 ? state.calibration.actualLengthMm / pixelDistance : 0;
}

function recalculateAllRoutes() {
  state.routes.forEach(recalculateRoute);
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
    const hasAuto = Number.isFinite(autoLengthMm);

    nextSegments.push({
      id: previous?.id || uid("segment"),
      fromPointId: from.id,
      toPointId: to.id,
      autoLengthMm: hasAuto ? autoLengthMm : null,
      manualLengthMm: hasManual ? manualLengthMm : undefined,
      selectedLengthMm: hasManual ? manualLengthMm : hasAuto ? autoLengthMm : 0,
      inputMethod: hasManual ? "manual" : hasAuto ? "auto" : "unset",
    });
  }

  return nextSegments;
}

function calculateAutoLength(from, to) {
  if (!state.calibration || from.page !== to.page || from.page !== state.calibration.page) {
    return null;
  }
  updateCalibrationScale();
  if (!state.calibration.mmPerPixel) return null;
  return Math.round(calculatePixelDistance(from, to) * state.calibration.mmPerPixel);
}

function calculatePixelDistance(from, to) {
  const { width, height } = getPageSize();
  const dx = (to.xRatio - from.xRatio) * width;
  const dy = (to.yRatio - from.yRatio) * height;
  return Math.sqrt(dx * dx + dy * dy);
}

function roundUp(value, unit) {
  if (!unit) return value;
  return Math.ceil(value / unit) * unit;
}

function renderOverlay() {
  const svg = elements.overlay;
  svg.textContent = "";
  renderCalibration();

  state.routes.forEach((route, routeIndex) => {
    const color = ROUTE_COLORS[routeIndex % ROUTE_COLORS.length];
    renderRouteLines(route, color);
    renderRoutePoints(route, color);
  });

  elements.deletePointBtn.disabled = !state.selectedPointId;
}

function renderCalibration() {
  const calibration = state.calibration;
  if (calibration && calibration.page === state.currentPage) {
    drawCalibrationLine(calibration.startPoint, calibration.endPoint, `${calibration.actualLengthMm}mm`);
  }

  if (state.pendingCalibrationPoint && state.pendingCalibrationPoint.page === state.currentPage) {
    drawCalibrationPoint(state.pendingCalibrationPoint, "始点");
  }
}

function drawCalibrationLine(startPoint, endPoint, labelText) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", `${startPoint.xRatio * 100}%`);
  line.setAttribute("y1", `${startPoint.yRatio * 100}%`);
  line.setAttribute("x2", `${endPoint.xRatio * 100}%`);
  line.setAttribute("y2", `${endPoint.yRatio * 100}%`);
  line.setAttribute("class", "calibration-line");
  elements.overlay.appendChild(line);

  drawCalibrationPoint(startPoint, "基準1");
  drawCalibrationPoint(endPoint, "基準2");

  const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  const midX = ((startPoint.xRatio + endPoint.xRatio) / 2) * 100;
  const midY = ((startPoint.yRatio + endPoint.yRatio) / 2) * 100;
  label.setAttribute("x", `${midX}%`);
  label.setAttribute("y", `${midY}%`);
  label.setAttribute("dx", "10");
  label.setAttribute("dy", "-10");
  label.setAttribute("class", "calibration-label");
  label.textContent = labelText;
  elements.overlay.appendChild(label);
}

function drawCalibrationPoint(point, text) {
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", `${point.xRatio * 100}%`);
  circle.setAttribute("cy", `${point.yRatio * 100}%`);
  circle.setAttribute("r", "7");
  circle.setAttribute("class", "calibration-point");
  elements.overlay.appendChild(circle);

  const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  label.setAttribute("x", `${point.xRatio * 100}%`);
  label.setAttribute("y", `${point.yRatio * 100}%`);
  label.setAttribute("dx", "10");
  label.setAttribute("dy", "-10");
  label.setAttribute("class", "calibration-label");
  label.textContent = text;
  elements.overlay.appendChild(label);
}

function renderRouteLines(route, color) {
  route.segments.forEach((segment) => {
    const from = route.points.find((point) => point.id === segment.fromPointId);
    const to = route.points.find((point) => point.id === segment.toPointId);
    if (!from || !to || from.page !== state.currentPage || to.page !== state.currentPage) return;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", `${from.xRatio * 100}%`);
    line.setAttribute("y1", `${from.yRatio * 100}%`);
    line.setAttribute("x2", `${to.xRatio * 100}%`);
    line.setAttribute("y2", `${to.yRatio * 100}%`);
    line.setAttribute("class", "overlay-line");
    line.setAttribute("stroke", color);
    elements.overlay.appendChild(line);
  });
}

function renderRoutePoints(route, color) {
  route.points.forEach((point, index) => {
    if (point.page !== state.currentPage) return;

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", `${point.xRatio * 100}%`);
    circle.setAttribute("cy", `${point.yRatio * 100}%`);
    circle.setAttribute("r", route.id === state.activeRouteId ? "8" : "6");
    circle.setAttribute("fill", color);
    circle.setAttribute("class", point.id === state.selectedPointId ? "overlay-point selected" : "overlay-point");
    circle.dataset.pointId = point.id;
    circle.dataset.routeId = route.id;
    elements.overlay.appendChild(circle);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", `${point.xRatio * 100}%`);
    label.setAttribute("y", `${point.yRatio * 100}%`);
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
    const autoText = Number.isFinite(segment.autoLengthMm) ? segment.autoLengthMm : "基準寸法未設定";
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>区間${index + 1}</td>
      <td>点${fromIndex}</td>
      <td>点${toIndex}</td>
      <td>${autoText}</td>
      <td><input type="number" min="0" step="10" value="${segment.selectedLengthMm}" data-segment-id="${segment.id}" aria-label="区間${index + 1}の採用長"></td>
      <td>${getInputMethodLabel(segment.inputMethod)}</td>
    `;
    elements.segmentTableBody.appendChild(row);
  });
}

function getInputMethodLabel(inputMethod) {
  if (inputMethod === "manual") return "手入力";
  if (inputMethod === "auto") return "自動";
  return "未設定";
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

  if (!state.calibration) {
    elements.calibrationStatus.textContent = state.pendingCalibrationPoint ? "終点を指定してください" : "未設定";
    elements.calibrationPixelDistance.textContent = "-";
    elements.calibrationScale.textContent = "-";
    return;
  }

  elements.calibrationStatus.textContent = `${state.calibration.actualLengthMm}mm 設定済み`;
  elements.calibrationPixelDistance.textContent = `画面上 ${state.calibration.pixelDistance.toFixed(1)}px`;
  elements.calibrationScale.textContent = `1px = ${state.calibration.mmPerPixel.toFixed(3)}mm`;
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
    mode: state.mode,
    calibration: state.calibration,
    routes: state.routes,
    activeRouteId: state.activeRouteId,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  elements.storageStatus.textContent = "ローカル保存: 保存済み";
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return;

  try {
    const data = JSON.parse(raw);
    state.pdfName = data.pdfName || "";
    state.currentPage = data.currentPage || 1;
    state.zoom = data.zoom || 100;
    state.mode = Object.values(MODES).includes(data.mode) ? data.mode : MODES.ROUTE;
    state.calibration = normalizeCalibration(data.calibration);
    state.routes = Array.isArray(data.routes) ? data.routes.map(normalizeRoute) : [];
    state.activeRouteId = data.activeRouteId || state.routes[0]?.id || "";
    updateCalibrationScale();
    recalculateAllRoutes();
    const route = getActiveRoute();
    if (route) syncInputsFromRoute(route);
    elements.storageStatus.textContent = "ローカル保存: 復元済み";
  } catch {
    elements.storageStatus.textContent = "ローカル保存: 復元失敗";
  }
}

function normalizeRoute(route) {
  const normalized = {
    ...route,
    points: Array.isArray(route.points) ? route.points.map(normalizePoint) : [],
    segments: Array.isArray(route.segments) ? route.segments : [],
  };
  return normalized;
}

function normalizePoint(point) {
  return {
    id: point.id || uid("point"),
    page: point.page || 1,
    xRatio: clamp(point.xRatio ?? point.x ?? 0, 0, 1),
    yRatio: clamp(point.yRatio ?? point.y ?? 0, 0, 1),
  };
}

function normalizeCalibration(calibration) {
  if (!calibration?.startPoint || !calibration?.endPoint) return null;
  return {
    id: calibration.id || uid("calibration"),
    page: calibration.page || calibration.startPoint.page || 1,
    startPoint: normalizePoint(calibration.startPoint),
    endPoint: normalizePoint(calibration.endPoint),
    pixelDistance: calibration.pixelDistance || 0,
    actualLengthMm: calibration.actualLengthMm || 0,
    mmPerPixel: calibration.mmPerPixel || 0,
  };
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
  state.pdfFrameSrc = "";
  state.currentPage = 1;
  render();
  saveState();
});

elements.prevPageBtn.addEventListener("click", () => {
  state.currentPage = Math.max(1, state.currentPage - 1);
  render();
  saveState();
});

elements.nextPageBtn.addEventListener("click", () => {
  state.currentPage += 1;
  render();
  saveState();
});

elements.pageInput.addEventListener("change", () => {
  state.currentPage = Math.max(1, Number(elements.pageInput.value) || 1);
  render();
  saveState();
});

elements.zoomOutBtn.addEventListener("click", () => {
  setZoom(state.zoom - 10);
});

elements.zoomInBtn.addEventListener("click", () => {
  setZoom(state.zoom + 10);
});

elements.fitWidthBtn.addEventListener("click", fitWidth);
elements.fitPageBtn.addEventListener("click", fitPage);

elements.modeSelect.addEventListener("change", () => {
  setMode(elements.modeSelect.value);
});

elements.calibrationModeBtn.addEventListener("click", () => {
  setMode(MODES.CALIBRATION);
});

elements.resetCalibrationBtn.addEventListener("click", resetCalibration);
elements.newRouteBtn.addEventListener("click", createRoute);

elements.confirmRouteBtn.addEventListener("click", () => {
  const route = getActiveRoute();
  if (!route || route.points.length < 2) {
    alert("ルート確定には2点以上が必要です。");
    return;
  }
  syncRouteFromInputs(route);
  route.confirmed = true;
  render();
  saveState();
});

elements.resetRouteBtn.addEventListener("click", () => {
  const route = getActiveRoute();
  if (!route) return;
  route.points = [];
  route.segments = [];
  route.confirmed = false;
  state.selectedPointId = "";
  recalculateRoute(route);
  render();
  saveState();
});

elements.exportCsvBtn.addEventListener("click", exportCsv);

elements.deletePointBtn.addEventListener("click", () => {
  if (state.selectedPointId) deletePoint(state.selectedPointId);
});

[elements.routeNameInput, elements.extraLengthInput, elements.roundingUnitInput].forEach((input) => {
  input.addEventListener("input", () => {
    const route = getActiveRoute();
    syncRouteFromInputs(route);
    render();
    saveState();
  });
});

elements.segmentTableBody.addEventListener("input", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const route = getActiveRoute();
  if (!route) return;
  const segment = route.segments.find((item) => item.id === input.dataset.segmentId);
  if (!segment) return;

  const value = getNonNegativeNumber(input.value, 0);
  segment.manualLengthMm = value;
  segment.selectedLengthMm = value;
  segment.inputMethod = "manual";
  recalculateRoute(route);
  saveState();
  renderResults();
  renderRoutes();
});

elements.segmentTableBody.addEventListener("change", renderSegments);

elements.routeTableBody.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-route-id]");
  if (!row) return;
  state.activeRouteId = row.dataset.routeId;
  state.selectedPointId = "";
  syncInputsFromRoute(getActiveRoute());
  render();
  saveState();
});

elements.pdfStage.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey) {
      event.preventDefault();
      const direction = event.deltaY > 0 ? -10 : 10;
      setZoom(state.zoom + direction, event);
      return;
    }

    if (event.shiftKey) {
      event.preventDefault();
      elements.pdfStage.scrollLeft += event.deltaY || event.deltaX;
    }
  },
  { passive: false },
);

elements.overlay.addEventListener("pointerdown", (event) => {
  if (state.mode === MODES.CALIBRATION) return;

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
  }
});

elements.overlay.addEventListener("click", (event) => {
  if (pointerMoved) {
    pointerMoved = false;
    return;
  }

  if (state.mode === MODES.CALIBRATION) {
    handleCalibrationClick(event.clientX, event.clientY);
    return;
  }

  if (event.target.dataset?.pointId) return;

  if (state.mode === MODES.ROUTE) {
    addRoutePoint(event.clientX, event.clientY);
  }
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
