import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";

const STORAGE_KEY = "wiring-length-app-v3";
const LEGACY_STORAGE_KEYS = ["wiring-length-app-v2", "wiring-length-app-v1"];
const ROUTE_COLORS = ["#c4312f", "#13795b", "#a15c08", "#7f4aa3", "#1d5f8f"];
const FALLBACK_PAGE_WIDTH = 900;
const FALLBACK_PAGE_HEIGHT = 636;
const MIN_ZOOM = 25;
const MAX_ZOOM = 400;

const MODES = {
  ROUTE: "route",
  CALIBRATION: "calibration",
  EDIT: "edit",
};

const VIEW_MODES = {
  FIT_WIDTH: "fit-width",
  FIT_PAGE: "fit-page",
  CUSTOM: "custom",
};

const elements = {
  workspace: document.querySelector(".workspace"),
  pdfInput: document.getElementById("pdfInput"),
  pdfStage: document.getElementById("pdfStage"),
  pdfPage: document.getElementById("pdfPage"),
  pdfCanvas: document.getElementById("pdfCanvas"),
  emptyState: document.getElementById("emptyState"),
  overlay: document.getElementById("routeOverlay"),
  pageInput: document.getElementById("pageInput"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  zoomOutBtn: document.getElementById("zoomOutBtn"),
  zoomInBtn: document.getElementById("zoomInBtn"),
  viewModeSelect: document.getElementById("viewModeSelect"),
  fitWidthBtn: document.getElementById("fitWidthBtn"),
  fitPageBtn: document.getElementById("fitPageBtn"),
  rotateLeftBtn: document.getElementById("rotateLeftBtn"),
  rotateRightBtn: document.getElementById("rotateRightBtn"),
  undoBtn: document.getElementById("undoBtn"),
  redoBtn: document.getElementById("redoBtn"),
  zoomLabel: document.getElementById("zoomLabel"),
  modeSelect: document.getElementById("modeSelect"),
  deletePointBtn: document.getElementById("deletePointBtn"),
  controlPane: document.getElementById("controlPane"),
  togglePanelBtn: document.getElementById("togglePanelBtn"),
  openPanelBtn: document.getElementById("openPanelBtn"),
  routeNameInput: document.getElementById("routeNameInput"),
  extraLengthInput: document.getElementById("extraLengthInput"),
  roundingUnitInput: document.getElementById("roundingUnitInput"),
  newRouteBtn: document.getElementById("newRouteBtn"),
  confirmRouteBtn: document.getElementById("confirmRouteBtn"),
  calibrationModeBtn: document.getElementById("calibrationModeBtn"),
  resetCalibrationBtn: document.getElementById("resetCalibrationBtn"),
  deleteLastPointBtn: document.getElementById("deleteLastPointBtn"),
  deleteSelectedPointPanelBtn: document.getElementById("deleteSelectedPointPanelBtn"),
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
  pdfName: "",
  hasPdf: false,
  currentPage: 1,
  pageCount: 0,
  zoom: 100,
  viewMode: VIEW_MODES.FIT_WIDTH,
  rotation: 0,
  mode: MODES.ROUTE,
  calibration: null,
  pendingCalibrationPoint: null,
  routes: [],
  activeRouteId: "",
  selectedPointId: "",
  panelCollapsed: false,
  undoStack: [],
  redoStack: [],
};

const pdfRuntime = {
  document: null,
  page: null,
  renderTask: null,
  renderId: 0,
  renderKey: "",
  baseViewport: { width: FALLBACK_PAGE_WIDTH, height: FALLBACK_PAGE_HEIGHT },
  cssViewport: { width: FALLBACK_PAGE_WIDTH, height: FALLBACK_PAGE_HEIGHT },
  orientation: "landscape",
};

let draggingPointId = "";
let pointerMoved = false;
let dragUndoCaptured = false;
const inputUndoCaptured = new WeakSet();

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

function createHistorySnapshot() {
  return structuredClone({
    currentPage: state.currentPage,
    zoom: state.zoom,
    viewMode: state.viewMode,
    rotation: state.rotation,
    mode: state.mode,
    calibration: state.calibration,
    pendingCalibrationPoint: state.pendingCalibrationPoint,
    routes: state.routes,
    activeRouteId: state.activeRouteId,
    selectedPointId: state.selectedPointId,
    panelCollapsed: state.panelCollapsed,
  });
}

function restoreHistorySnapshot(snapshot) {
  state.currentPage = snapshot.currentPage;
  state.zoom = snapshot.zoom;
  state.viewMode = snapshot.viewMode;
  state.rotation = normalizeRotation(snapshot.rotation || 0);
  state.mode = snapshot.mode;
  state.calibration = snapshot.calibration;
  state.pendingCalibrationPoint = snapshot.pendingCalibrationPoint;
  state.routes = Array.isArray(snapshot.routes) ? snapshot.routes.map(normalizeRoute) : [];
  state.activeRouteId = snapshot.activeRouteId;
  state.selectedPointId = snapshot.selectedPointId;
  state.panelCollapsed = Boolean(snapshot.panelCollapsed);
  syncInputsFromRoute(getActiveRoute());
  updateBaseViewport();
  updateCalibrationScale();
  recalculateAllRoutes();
  render();
  saveState();
}

function pushUndo() {
  state.undoStack.push(createHistorySnapshot());
  if (state.undoStack.length > 100) {
    state.undoStack.shift();
  }
  state.redoStack = [];
}

function undo() {
  const snapshot = state.undoStack.pop();
  if (!snapshot) return;
  state.redoStack.push(createHistorySnapshot());
  restoreHistorySnapshot(snapshot);
}

function redo() {
  const snapshot = state.redoStack.pop();
  if (!snapshot) return;
  state.undoStack.push(createHistorySnapshot());
  restoreHistorySnapshot(snapshot);
}

function isTextEditingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

async function loadPdfFile(file) {
  const buffer = await file.arrayBuffer();
  if (pdfRuntime.renderTask) {
    pdfRuntime.renderTask.cancel();
  }

  pdfRuntime.document = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  state.pdfName = file.name;
  state.hasPdf = true;
  state.currentPage = 1;
  state.pageCount = pdfRuntime.document.numPages;
  state.rotation = 0;
  state.viewMode = VIEW_MODES.FIT_WIDTH;
  pdfRuntime.renderKey = "";
  await loadPdfPage(1);
  fitWidth(false);
  render();
  saveState();
}

async function loadPdfPage(pageNumber) {
  if (!pdfRuntime.document) return;
  state.currentPage = clamp(pageNumber, 1, pdfRuntime.document.numPages);
  pdfRuntime.page = await pdfRuntime.document.getPage(state.currentPage);
  pdfRuntime.renderKey = "";
  updateBaseViewport();
}

function updateBaseViewport() {
  if (!pdfRuntime.page) {
    pdfRuntime.baseViewport = { width: FALLBACK_PAGE_WIDTH, height: FALLBACK_PAGE_HEIGHT };
    pdfRuntime.orientation = "landscape";
    return;
  }

  const viewport = pdfRuntime.page.getViewport({ scale: 1, rotation: state.rotation });
  pdfRuntime.baseViewport = { width: viewport.width, height: viewport.height };
  pdfRuntime.orientation = viewport.width > viewport.height ? "landscape" : "portrait";
}

function createRoute() {
  pushUndo();
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
  renderPanel();
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
  if ([VIEW_MODES.FIT_WIDTH, VIEW_MODES.FIT_PAGE].includes(state.viewMode)) {
    elements.viewModeSelect.value = state.viewMode;
  } else if ([100, 150, 200].includes(Math.round(state.zoom))) {
    elements.viewModeSelect.value = String(Math.round(state.zoom));
  }
}

function renderPanel() {
  elements.workspace.classList.toggle("panel-collapsed", state.panelCollapsed);
  elements.openPanelBtn.hidden = !state.panelCollapsed;
}

function renderPdfLayer() {
  const hasPdf = Boolean(state.hasPdf && pdfRuntime.page);
  elements.pdfPage.hidden = !hasPdf;
  setEmptyStateVisible(!hasPdf);

  if (!hasPdf) {
    setPdfPageSize(FALLBACK_PAGE_WIDTH, FALLBACK_PAGE_HEIGHT);
    return;
  }

  renderPdfPageSize();
  renderPdfCanvas();
  elements.pageInput.value = state.currentPage;
  elements.pageInput.max = state.pageCount || "";
  elements.zoomLabel.textContent = `${Math.round(state.zoom)}%`;
}

function setPdfPageSize(width, height) {
  elements.pdfPage.style.width = `${Math.round(width)}px`;
  elements.pdfPage.style.height = `${Math.round(height)}px`;
}

function renderPdfPageSize() {
  const width = pdfRuntime.baseViewport.width * (state.zoom / 100);
  const height = pdfRuntime.baseViewport.height * (state.zoom / 100);
  pdfRuntime.cssViewport = { width, height };
  setPdfPageSize(width, height);
}

async function renderPdfCanvas() {
  if (!pdfRuntime.page) return;

  const key = `${state.currentPage}:${state.zoom}:${state.rotation}`;
  if (pdfRuntime.renderKey === key) return;
  pdfRuntime.renderKey = key;

  const renderId = ++pdfRuntime.renderId;
  const viewport = pdfRuntime.page.getViewport({ scale: state.zoom / 100, rotation: state.rotation });
  const outputScale = window.devicePixelRatio || 1;
  const canvas = elements.pdfCanvas;
  const context = canvas.getContext("2d");

  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  if (pdfRuntime.renderTask) {
    pdfRuntime.renderTask.cancel();
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);

  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
  pdfRuntime.renderTask = pdfRuntime.page.render({ canvasContext: context, viewport, transform });

  try {
    await pdfRuntime.renderTask.promise;
  } catch (error) {
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);
    }
  } finally {
    if (renderId === pdfRuntime.renderId) {
      pdfRuntime.renderTask = null;
    }
  }
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

function setZoom(nextZoom, anchorEvent, viewMode = VIEW_MODES.CUSTOM) {
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
  state.viewMode = viewMode;
  render();

  const newSize = getPageSize();
  stage.scrollLeft += (newSize.width - oldSize.width) * anchorXRatio;
  stage.scrollTop += (newSize.height - oldSize.height) * anchorYRatio;
  saveState();
}

function fitWidth(shouldSave = true) {
  updateBaseViewport();
  const availableWidth = Math.max(320, elements.pdfStage.clientWidth - 48);
  setZoom((availableWidth / pdfRuntime.baseViewport.width) * 100, null, VIEW_MODES.FIT_WIDTH);
  if (shouldSave) saveState();
}

function fitPage(shouldSave = true) {
  updateBaseViewport();
  const availableWidth = Math.max(320, elements.pdfStage.clientWidth - 48);
  const availableHeight = Math.max(320, elements.pdfStage.clientHeight - 48);
  const scaleX = availableWidth / pdfRuntime.baseViewport.width;
  const scaleY = availableHeight / pdfRuntime.baseViewport.height;
  setZoom(Math.min(scaleX, scaleY) * 100, null, VIEW_MODES.FIT_PAGE);
  if (shouldSave) saveState();
}

function getPageSize() {
  return {
    width: elements.pdfPage.offsetWidth || pdfRuntime.cssViewport.width || FALLBACK_PAGE_WIDTH,
    height: elements.pdfPage.offsetHeight || pdfRuntime.cssViewport.height || FALLBACK_PAGE_HEIGHT,
  };
}

function pointerToPagePoint(clientX, clientY) {
  const rect = elements.pdfPage.getBoundingClientRect();
  return {
    xRatio: clamp((clientX - rect.left) / rect.width, 0, 1),
    yRatio: clamp((clientY - rect.top) / rect.height, 0, 1),
    page: state.currentPage,
    rotation: state.rotation,
  };
}

function addRoutePoint(clientX, clientY) {
  let route = getActiveRoute();
  if (!route) {
    pushUndo();
    route = {
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
  } else {
    pushUndo();
  }

  const point = pointerToPagePoint(clientX, clientY);
  route.points.push({
    id: uid("point"),
    page: point.page,
    xRatio: point.xRatio,
    yRatio: point.yRatio,
    rotation: point.rotation,
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
  point.rotation = next.rotation;
  route.confirmed = false;
  recalculateRoute(route);
  render();
}

function deletePoint(pointId) {
  const route = getActiveRoute();
  if (!route) return;
  pushUndo();
  route.points = route.points.filter((point) => point.id !== pointId);
  if (state.selectedPointId === pointId) {
    state.selectedPointId = "";
  }
  route.confirmed = false;
  recalculateRoute(route);
  render();
  saveState();
}

function deleteLastPoint() {
  const route = getActiveRoute();
  if (!route || route.points.length === 0) return;
  pushUndo();
  const removed = route.points.pop();
  if (removed?.id === state.selectedPointId) {
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

  pushUndo();
  state.calibration = {
    id: uid("calibration"),
    page: clickedPoint.page,
    rotation: state.rotation,
    startPoint: state.pendingCalibrationPoint,
    endPoint: clickedPoint,
    pixelDistance: 0,
    actualLengthMm,
    mmPerPixel: 0,
  };

  state.pendingCalibrationPoint = null;
  state.mode = MODES.ROUTE;
  updateCalibrationScale();
  render();
  saveState();
}

function resetCalibration() {
  if (!state.calibration && !state.pendingCalibrationPoint) return;
  pushUndo();
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

  const route = getActiveRoute();
  const hasSelectedPoint = Boolean(state.selectedPointId);
  elements.deletePointBtn.disabled = !hasSelectedPoint;
  elements.deleteSelectedPointPanelBtn.disabled = !hasSelectedPoint;
  elements.deleteLastPointBtn.disabled = !route || route.points.length === 0;
  elements.undoBtn.disabled = state.undoStack.length === 0;
  elements.redoBtn.disabled = state.redoStack.length === 0;
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
  const orientationLabel = pdfRuntime.orientation === "landscape" ? "横向き" : "縦向き";
  const pageSizeLabel = `${Math.round(pdfRuntime.baseViewport.width)}x${Math.round(pdfRuntime.baseViewport.height)}`;

  elements.pointCount.textContent = route?.points.length || 0;
  elements.segmentCount.textContent = route?.segments.length || 0;
  elements.routeState.textContent = route
    ? `${route.confirmed ? "確定済み" : "編集中"} / ${orientationLabel} / ${pageSizeLabel} / 回転${state.rotation}°`
    : `未作成 / ${orientationLabel} / ${pageSizeLabel} / 回転${state.rotation}°`;

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
    pageCount: state.pageCount,
    zoom: state.zoom,
    viewMode: state.viewMode,
    rotation: state.rotation,
    mode: state.mode,
    calibration: state.calibration,
    routes: state.routes,
    activeRouteId: state.activeRouteId,
    panelCollapsed: state.panelCollapsed,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  elements.storageStatus.textContent = "ローカル保存: 保存済み";
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY) || LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
  if (!raw) return;

  try {
    const data = JSON.parse(raw);
    state.pdfName = data.pdfName || "";
    state.currentPage = data.currentPage || 1;
    state.pageCount = data.pageCount || 0;
    state.zoom = data.zoom || 100;
    state.viewMode = data.viewMode || VIEW_MODES.FIT_WIDTH;
    state.rotation = normalizeRotation(data.rotation || 0);
    state.mode = Object.values(MODES).includes(data.mode) ? data.mode : MODES.ROUTE;
    state.calibration = normalizeCalibration(data.calibration);
    state.routes = Array.isArray(data.routes) ? data.routes.map(normalizeRoute) : [];
    state.activeRouteId = data.activeRouteId || state.routes[0]?.id || "";
    state.panelCollapsed = Boolean(data.panelCollapsed);
    updateCalibrationScale();
    recalculateAllRoutes();
    const route = getActiveRoute();
    if (route) syncInputsFromRoute(route);
    elements.storageStatus.textContent = "ローカル保存: 復元済み。PDFは再読み込みしてください";
  } catch {
    elements.storageStatus.textContent = "ローカル保存: 復元失敗";
  }
}

function normalizeRoute(route) {
  return {
    ...route,
    points: Array.isArray(route.points) ? route.points.map(normalizePoint) : [],
    segments: Array.isArray(route.segments) ? route.segments : [],
  };
}

function normalizePoint(point) {
  return {
    id: point.id || uid("point"),
    page: point.page || 1,
    xRatio: clamp(point.xRatio ?? point.x ?? 0, 0, 1),
    yRatio: clamp(point.yRatio ?? point.y ?? 0, 0, 1),
    rotation: normalizeRotation(point.rotation || 0),
  };
}

function normalizeCalibration(calibration) {
  if (!calibration?.startPoint || !calibration?.endPoint) return null;
  return {
    id: calibration.id || uid("calibration"),
    page: calibration.page || calibration.startPoint.page || 1,
    rotation: normalizeRotation(calibration.rotation || 0),
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

function normalizeRotation(rotation) {
  return ((rotation % 360) + 360) % 360;
}

async function changePage(nextPage) {
  if (!pdfRuntime.document) return;
  await loadPdfPage(nextPage);
  if (state.viewMode === VIEW_MODES.FIT_WIDTH) {
    fitWidth(false);
  } else if (state.viewMode === VIEW_MODES.FIT_PAGE) {
    fitPage(false);
  } else {
    render();
  }
  saveState();
}

async function rotatePage(delta) {
  state.rotation = normalizeRotation(state.rotation + delta);
  updateBaseViewport();
  if (state.viewMode === VIEW_MODES.FIT_WIDTH) {
    fitWidth(false);
  } else if (state.viewMode === VIEW_MODES.FIT_PAGE) {
    fitPage(false);
  } else {
    render();
  }
  saveState();
}

elements.pdfInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    elements.storageStatus.textContent = "PDF読み込み中";
    await loadPdfFile(file);
  } catch (error) {
    console.error(error);
    alert("PDFの読み込みに失敗しました。");
    elements.storageStatus.textContent = "PDF読み込み失敗";
  }
});

elements.prevPageBtn.addEventListener("click", () => {
  changePage(Math.max(1, state.currentPage - 1));
});

elements.nextPageBtn.addEventListener("click", () => {
  changePage(Math.min(state.pageCount || state.currentPage + 1, state.currentPage + 1));
});

elements.pageInput.addEventListener("change", () => {
  changePage(Math.max(1, Number(elements.pageInput.value) || 1));
});

elements.zoomOutBtn.addEventListener("click", () => {
  setZoom(state.zoom - 10);
});

elements.zoomInBtn.addEventListener("click", () => {
  setZoom(state.zoom + 10);
});

elements.viewModeSelect.addEventListener("change", () => {
  const value = elements.viewModeSelect.value;
  if (value === VIEW_MODES.FIT_WIDTH) {
    fitWidth();
  } else if (value === VIEW_MODES.FIT_PAGE) {
    fitPage();
  } else {
    setZoom(Number(value), null, VIEW_MODES.CUSTOM);
  }
});

elements.fitWidthBtn.addEventListener("click", () => fitWidth());
elements.fitPageBtn.addEventListener("click", () => fitPage());
elements.rotateLeftBtn.addEventListener("click", () => rotatePage(-90));
elements.rotateRightBtn.addEventListener("click", () => rotatePage(90));
elements.undoBtn.addEventListener("click", undo);
elements.redoBtn.addEventListener("click", redo);

elements.modeSelect.addEventListener("change", () => {
  setMode(elements.modeSelect.value);
});

elements.togglePanelBtn.addEventListener("click", () => {
  state.panelCollapsed = true;
  render();
  if (state.viewMode === VIEW_MODES.FIT_WIDTH) fitWidth(false);
  saveState();
});

elements.openPanelBtn.addEventListener("click", () => {
  state.panelCollapsed = false;
  render();
  if (state.viewMode === VIEW_MODES.FIT_WIDTH) fitWidth(false);
  saveState();
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
  if (!confirm("現在のルートをすべて削除します。よろしいですか？")) return;
  pushUndo();
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

elements.deleteSelectedPointPanelBtn.addEventListener("click", () => {
  if (state.selectedPointId) deletePoint(state.selectedPointId);
});

elements.deleteLastPointBtn.addEventListener("click", deleteLastPoint);

[elements.routeNameInput, elements.extraLengthInput, elements.roundingUnitInput].forEach((input) => {
  input.addEventListener("focusout", () => {
    inputUndoCaptured.delete(input);
  });

  input.addEventListener("input", () => {
    if (!inputUndoCaptured.has(input)) {
      pushUndo();
      inputUndoCaptured.add(input);
    }
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

  if (!inputUndoCaptured.has(input)) {
    pushUndo();
    inputUndoCaptured.add(input);
  }

  const value = getNonNegativeNumber(input.value, 0);
  segment.manualLengthMm = value;
  segment.selectedLengthMm = value;
  segment.inputMethod = "manual";
  recalculateRoute(route);
  saveState();
  renderResults();
  renderRoutes();
});

elements.segmentTableBody.addEventListener("change", (event) => {
  if (event.target instanceof HTMLInputElement) {
    inputUndoCaptured.delete(event.target);
  }
  renderSegments();
});

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
  dragUndoCaptured = false;
  syncInputsFromRoute(getActiveRoute());
  elements.overlay.setPointerCapture(event.pointerId);
  render();
});

elements.overlay.addEventListener("pointermove", (event) => {
  if (!draggingPointId) return;
  if (!dragUndoCaptured) {
    pushUndo();
    dragUndoCaptured = true;
  }
  pointerMoved = true;
  movePoint(draggingPointId, event.clientX, event.clientY);
});

elements.overlay.addEventListener("pointerup", (event) => {
  if (draggingPointId) {
    saveState();
    draggingPointId = "";
    dragUndoCaptured = false;
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

document.addEventListener("keydown", (event) => {
  if (isTextEditingTarget(event.target)) return;

  const key = event.key.toLowerCase();
  if (event.ctrlKey && !event.altKey && key === "z") {
    event.preventDefault();
    if (event.shiftKey) {
      redo();
    } else {
      undo();
    }
    return;
  }

  if (event.ctrlKey && !event.altKey && key === "y") {
    event.preventDefault();
    redo();
    return;
  }

  if (event.key === "Delete" && state.selectedPointId) {
    event.preventDefault();
    deletePoint(state.selectedPointId);
  }
});

window.addEventListener("resize", () => {
  if (!state.hasPdf) return;
  if (state.viewMode === VIEW_MODES.FIT_WIDTH) {
    fitWidth(false);
  } else if (state.viewMode === VIEW_MODES.FIT_PAGE) {
    fitPage(false);
  }
});

loadState();
render();
