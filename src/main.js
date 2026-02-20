import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const catalogSources = [
  'https://samsobjectfinder.com/api/v1/objects.full.json',
  'https://samsobjectfinder.com/static/api/v1/objects.full.json',
  './public/data/objects.min.json',
];
const FLOOR_Y = 0;
const LAYOUT_STORAGE_KEY = 'sams_dayz_layout_tool_v1';

const ui = {
  canvas: document.getElementById('viewport'),
  viewportWrap: document.getElementById('viewportWrap'),
  list: document.getElementById('objectList'),
  placedList: document.getElementById('placedList'),
  search: document.getElementById('searchInput'),
  statusText: document.getElementById('statusText'),
  exportScene: document.getElementById('exportScene'),
  copyExport: document.getElementById('copyExport'),
  undoAction: document.getElementById('undoAction'),
  importScene: document.getElementById('importScene'),
  deleteSelected: document.getElementById('deleteSelected'),
  duplicateSelected: document.getElementById('duplicateSelected'),
};

const state = {
  catalog: [],
  filtered: [],
  selectedCatalog: null,
  selectedPlaced: null,
  placedObjects: [],
  dragCatalog: null,
  undoStack: [],
  nextInstanceId: 1,
  navKeys: {
    w: false,
    a: false,
    s: false,
    d: false,
    q: false,
    z: false,
    shift: false,
  },
  lookMode: false,
  isTransformDragging: false,
  lookYaw: 0,
  lookPitch: 0,
  lookLastX: null,
  lookLastY: null,
  catalogSource: null,
  stickyCatalog: null,
  stickyPreview: null,
  placeEdgeEffects: [],
  placeImpactEffects: [],
  persistTimer: null,
};

const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(ui.canvas.clientWidth, ui.canvas.clientHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0f16);
scene.fog = new THREE.Fog(0x0a0f16, 120, 650);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
camera.position.set(20, 18, 20);

const orbit = new OrbitControls(camera, ui.canvas);
orbit.target.set(0, 0, 0);
orbit.update();

const transform = new TransformControls(camera, renderer.domElement);
let transformStartSnapshot = null;
transform.addEventListener('dragging-changed', (event) => {
  state.isTransformDragging = event.value;
  updateOrbitEnabled();
});
transform.addEventListener('objectChange', () => {
  if (state.selectedPlaced) clampPlacedAboveFloor(state.selectedPlaced);
  syncSelectionFields();
});
transform.addEventListener('mouseDown', () => {
  if (state.selectedPlaced) {
    transformStartSnapshot = snapshotPlaced(state.selectedPlaced);
  }
});
transform.addEventListener('mouseUp', () => {
  if (!state.selectedPlaced || !transformStartSnapshot) return;
  const before = transformStartSnapshot;
  const after = snapshotPlaced(state.selectedPlaced);
  if (!sameSnapshot(before, after)) {
    const objectRef = state.selectedPlaced;
    pushUndo(() => {
      if (!scene.children.includes(objectRef)) return;
      applySnapshot(objectRef, before);
      setSelectedPlaced(objectRef);
    });
    schedulePersistPlacedObjects();
  }
  transformStartSnapshot = null;
});
scene.add(transform);

const hemi = new THREE.HemisphereLight(0xffffff, 0x203040, 0.8);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(26, 34, 16);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.camera.left = -140;
dir.shadow.camera.right = 140;
dir.shadow.camera.top = 140;
dir.shadow.camera.bottom = -140;
dir.shadow.camera.near = 1;
dir.shadow.camera.far = 220;
dir.shadow.bias = -0.0002;
scene.add(dir);
const pulseLight = new THREE.PointLight(0x76c2ff, 0.9, 120, 2);
pulseLight.position.set(0, 6, 0);
scene.add(pulseLight);
const pulseBaseIntensity = 0.9;

const grid = new THREE.GridHelper(500, 200, 0x4f6580, 0x30435a);
grid.position.y = FLOOR_Y + 0.01;
scene.add(grid);

const groundGeom = new THREE.PlaneGeometry(500, 500);
const grassTexture = createGrassTexture();
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x9db58f,
  map: grassTexture,
  roughness: 0.95,
  metalness: 0.02,
  transparent: false,
  opacity: 1,
  side: THREE.DoubleSide,
});
const ground = new THREE.Mesh(groundGeom, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = FLOOR_Y;
ground.name = 'ground';
ground.receiveShadow = true;
scene.add(ground);

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const clock = new THREE.Clock();
const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');
const objectTextureCache = new Map();

function createGrassTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#6c895f';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 2400; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const w = 1 + Math.random() * 2.2;
    const h = 1 + Math.random() * 5.4;
    const alpha = 0.1 + Math.random() * 0.25;
    const g = 90 + Math.floor(Math.random() * 90);
    ctx.fillStyle = `rgba(${35 + Math.floor(Math.random() * 25)},${g},${30 + Math.floor(Math.random() * 25)},${alpha})`;
    ctx.fillRect(x, y, w, h);
  }

  for (let i = 0; i < 1100; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const s = Math.random() * 2;
    ctx.fillStyle = `rgba(200,170,110,${0.05 + Math.random() * 0.07})`;
    ctx.fillRect(x, y, s, s);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(36, 36);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
}

function applyObjectImageTexture(material, objDef) {
  const imageUrl = getObjectImageUrl(objDef);
  if (!imageUrl) return;

  if (objectTextureCache.has(imageUrl)) {
    const cached = objectTextureCache.get(imageUrl);
    if (cached) {
      material.map = cached;
      material.needsUpdate = true;
    }
    return;
  }

  objectTextureCache.set(imageUrl, null);
  textureLoader.load(
    imageUrl,
    (tex) => {
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      objectTextureCache.set(imageUrl, tex);
      material.map = tex;
      material.needsUpdate = true;
    },
    undefined,
    () => {
      objectTextureCache.delete(imageUrl);
    },
  );
}

function onResize() {
  const w = ui.canvas.clientWidth;
  const h = ui.canvas.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

function formatDim(dims) {
  return `${dims.map((v) => Number(v).toFixed(2)).join(' x ')}`;
}

function setStatus(message) {
  if (ui.statusText) ui.statusText.textContent = message;
}

function describeDimensionSource(objDef) {
  const source = objDef.dimensionsSource || 'unknown';
  const status = objDef.bboxStatus || 'unknown';
  return `source=${source}, bboxStatus=${status}`;
}

function getObjectImageUrl(objDef) {
  if (objDef.imageUrl) return objDef.imageUrl;
  if (objDef.image) return `https://samsobjectfinder.com/${String(objDef.image).replace(/^\/+/, '')}`;
  return '';
}

function normalizeBoxData(obj) {
  const dims = Array.isArray(obj.dimensionsVisual) && obj.dimensionsVisual.length === 3
    ? obj.dimensionsVisual.map((n) => Number(n) || 2.5)
    : [2.5, 2.5, 2.5];

  let center = [0, 0, 0];
  if (Array.isArray(obj.bboxMinVisual) && Array.isArray(obj.bboxMaxVisual)) {
    center = [
      (Number(obj.bboxMinVisual[0]) + Number(obj.bboxMaxVisual[0])) / 2,
      (Number(obj.bboxMinVisual[1]) + Number(obj.bboxMaxVisual[1])) / 2,
      (Number(obj.bboxMinVisual[2]) + Number(obj.bboxMaxVisual[2])) / 2,
    ];
  }

  return { dims, center };
}

function normalizeCatalogEntry(item) {
  const dims = Array.isArray(item?.dimensionsVisual) && item.dimensionsVisual.length === 3
    ? item.dimensionsVisual.map((n) => Number(n) || 2.5)
    : [2.5, 2.5, 2.5];
  const hasKnownDimensions = (item?.bboxStatus === 'matched')
    && Array.isArray(item?.bboxMinVisual)
    && Array.isArray(item?.bboxMaxVisual);

  return {
    objectName: item?.objectName || item?.Type || 'unknown_object',
    inGameName: item?.inGameName || '-',
    category: item?.category || 'Uncategorized',
    path: item?.path || '',
    imageUrl: item?.imageUrl || '',
    image: item?.image || '',
    bboxStatus: item?.bboxStatus || 'unknown',
    dimensionsSource: item?.dimensionsSource || 'unknown',
    dimensionsVisual: dims,
    bboxMinVisual: Array.isArray(item?.bboxMinVisual) ? item.bboxMinVisual : null,
    bboxMaxVisual: Array.isArray(item?.bboxMaxVisual) ? item.bboxMaxVisual : null,
    hasKnownDimensions,
  };
}

function serializePlacedObjects() {
  return state.placedObjects.map((o) => {
    const def = o.userData?.objectDef || {};
    return {
      objectName: def.objectName || 'unknown_object',
      path: def.path || '',
      category: def.category || 'Imported',
      bboxStatus: def.bboxStatus || 'unknown',
      dimensionsSource: def.dimensionsSource || 'unknown',
      dimensionsVisual: o.userData?.dims || def.dimensionsVisual || [2.5, 2.5, 2.5],
      bboxMinVisual: Array.isArray(def.bboxMinVisual) ? def.bboxMinVisual : null,
      bboxMaxVisual: Array.isArray(def.bboxMaxVisual) ? def.bboxMaxVisual : null,
      position: [o.position.x, o.position.y, o.position.z],
      rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
      scale: [o.scale.x, o.scale.y, o.scale.z],
    };
  });
}

function persistPlacedObjectsNow() {
  try {
    const payload = serializePlacedObjects();
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to persist layout:', error);
  }
}

function schedulePersistPlacedObjects() {
  if (state.persistTimer) clearTimeout(state.persistTimer);
  state.persistTimer = setTimeout(() => {
    persistPlacedObjectsNow();
    state.persistTimer = null;
  }, 180);
}

function restorePlacedObjectsFromStorage() {
  let raw = null;
  try {
    raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
  } catch {
    return 0;
  }
  if (!raw) return 0;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (!Array.isArray(data)) return 0;

  clearPlaced(false);

  for (const item of data) {
    const existing = state.catalog.find((x) => x.objectName === item.objectName);
    const def = existing || {
      objectName: item.objectName || 'unknown_object',
      path: item.path || '',
      category: item.category || 'Imported',
      bboxStatus: item.bboxStatus || 'unknown',
      dimensionsSource: item.dimensionsSource || 'unknown',
      dimensionsVisual: item.dimensionsVisual || [2.5, 2.5, 2.5],
      bboxMinVisual: Array.isArray(item.bboxMinVisual) ? item.bboxMinVisual : null,
      bboxMaxVisual: Array.isArray(item.bboxMaxVisual) ? item.bboxMaxVisual : null,
      hasKnownDimensions: item.bboxStatus === 'matched',
    };
    const dims = Array.isArray(item.dimensionsVisual) ? item.dimensionsVisual : def.dimensionsVisual;
    const placed = buildBoxMesh(def, dims);
    if (Array.isArray(item.position) && item.position.length === 3) {
      placed.position.set(Number(item.position[0]) || 0, Number(item.position[1]) || 0, Number(item.position[2]) || 0);
    }
    if (Array.isArray(item.rotation) && item.rotation.length === 3) {
      placed.rotation.set(Number(item.rotation[0]) || 0, Number(item.rotation[1]) || 0, Number(item.rotation[2]) || 0);
    }
    if (Array.isArray(item.scale) && item.scale.length === 3) {
      placed.scale.set(Number(item.scale[0]) || 1, Number(item.scale[1]) || 1, Number(item.scale[2]) || 1);
    }
    clampPlacedAboveFloor(placed);
    scene.add(placed);
    state.placedObjects.push(placed);
  }

  if (state.placedObjects.length) {
    setSelectedPlaced(state.placedObjects[0]);
  } else {
    setSelectedPlaced(null);
  }
  renderPlacedList();
  return state.placedObjects.length;
}

function pushUndo(undoFn) {
  state.undoStack.push(undoFn);
}

function undoLastAction() {
  const undo = state.undoStack.pop();
  if (!undo) return;
  undo();
  schedulePersistPlacedObjects();
}

function snapshotPlaced(obj) {
  return {
    position: [obj.position.x, obj.position.y, obj.position.z],
    rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
    scale: [obj.scale.x, obj.scale.y, obj.scale.z],
    dims: [...(obj.userData.dims || [1, 1, 1])],
  };
}

function sameSnapshot(a, b) {
  const epsilon = 1e-6;
  const flatA = [...a.position, ...a.rotation, ...a.scale, ...a.dims];
  const flatB = [...b.position, ...b.rotation, ...b.scale, ...b.dims];
  if (flatA.length !== flatB.length) return false;
  for (let i = 0; i < flatA.length; i += 1) {
    if (Math.abs(flatA[i] - flatB[i]) > epsilon) return false;
  }
  return true;
}

function getMinWorldY(holder) {
  const worldBox = new THREE.Box3().setFromObject(holder);
  return worldBox.min.y;
}

function clampPlacedAboveFloor(holder) {
  const minY = getMinWorldY(holder);
  if (minY < FLOOR_Y) {
    holder.position.y += FLOOR_Y - minY;
  }
}

function applyKeyboardNavigation(deltaSeconds) {
  const axisZ = (state.navKeys.w ? 1 : 0) - (state.navKeys.s ? 1 : 0);
  const axisX = (state.navKeys.d ? 1 : 0) - (state.navKeys.a ? 1 : 0);
  const axisY = (state.navKeys.q ? 1 : 0) - (state.navKeys.z ? 1 : 0);
  if (axisX === 0 && axisY === 0 && axisZ === 0) return;

  const speed = (state.navKeys.shift ? 26 : 12) * deltaSeconds;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();

  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3(0, 1, 0);

  const movement = new THREE.Vector3()
    .addScaledVector(forward, axisZ)
    .addScaledVector(right, axisX)
    .addScaledVector(up, axisY);

  if (movement.lengthSq() === 0) return;
  movement.normalize().multiplyScalar(speed);

  camera.position.add(movement);
  orbit.target.add(movement);
  orbit.update();
}

function spawnPlaceEdgeFlash(placed) {
  const wire = placed.children.find((c) => c.name === 'wire');
  if (!wire || !wire.geometry) return;

  const flashMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
  });
  const flash = new THREE.LineSegments(wire.geometry.clone(), flashMaterial);
  flash.name = 'placeEdgeFlash';
  flash.position.copy(wire.position);
  flash.scale.set(1.001, 1.001, 1.001);
  placed.add(flash);

  state.placeEdgeEffects.push({
    placed,
    flash,
    age: 0,
    lifetime: 0.28,
  });
}

function updatePlaceEdgeEffects(deltaSeconds) {
  for (let i = state.placeEdgeEffects.length - 1; i >= 0; i -= 1) {
    const fx = state.placeEdgeEffects[i];
    fx.age += deltaSeconds;
    const t = fx.age / fx.lifetime;
    fx.flash.material.opacity = Math.max(0, 1 - t);
    const s = 1.001 + t * 0.02;
    fx.flash.scale.set(s, s, s);

    if (fx.age >= fx.lifetime || !scene.children.includes(fx.placed)) {
      fx.placed.remove(fx.flash);
      fx.flash.geometry.dispose();
      fx.flash.material.dispose();
      state.placeEdgeEffects.splice(i, 1);
    }
  }
}

function spawnPlaceImpactEffect(placed) {
  const dims = placed.userData?.dims || [2.5, 2.5, 2.5];
  const footprint = Math.max(0.7, dims[0], dims[2]) * 0.5;

  const dustCount = 12;
  const dustGeom = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(dustCount * 3);
  const dustVelocities = [];
  const dustBase = new THREE.Vector3(placed.position.x, FLOOR_Y + 0.03, placed.position.z);

  for (let i = 0; i < dustCount; i += 1) {
    const angle = (i / dustCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
    const r = footprint * (0.3 + Math.random() * 0.7);
    dustPositions[i * 3 + 0] = dustBase.x + Math.cos(angle) * r;
    dustPositions[i * 3 + 1] = dustBase.y + Math.random() * 0.12;
    dustPositions[i * 3 + 2] = dustBase.z + Math.sin(angle) * r;

    dustVelocities.push(new THREE.Vector3(
      Math.cos(angle) * (0.6 + Math.random() * 0.7),
      0.2 + Math.random() * 0.28,
      Math.sin(angle) * (0.6 + Math.random() * 0.7),
    ));
  }

  dustGeom.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0xb7bfc8,
    size: 0.1 + footprint * 0.05,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const dustPoints = new THREE.Points(dustGeom, dustMat);
  scene.add(dustPoints);

  state.placeImpactEffects.push({
    dustPoints,
    dustVelocities,
    age: 0,
    lifetime: 0.26,
  });
}

function updatePlaceImpactEffects(deltaSeconds) {
  for (let i = state.placeImpactEffects.length - 1; i >= 0; i -= 1) {
    const fx = state.placeImpactEffects[i];
    fx.age += deltaSeconds;
    const t = Math.min(1, fx.age / fx.lifetime);

    const posAttr = fx.dustPoints.geometry.getAttribute('position');
    for (let p = 0; p < fx.dustVelocities.length; p += 1) {
      const v = fx.dustVelocities[p];
      posAttr.array[p * 3 + 0] += v.x * deltaSeconds;
      posAttr.array[p * 3 + 1] += v.y * deltaSeconds;
      posAttr.array[p * 3 + 2] += v.z * deltaSeconds;
      v.multiplyScalar(1 - Math.min(0.95, 5.2 * deltaSeconds));
      v.y -= 0.8 * deltaSeconds;
      if (posAttr.array[p * 3 + 1] < FLOOR_Y + 0.015) posAttr.array[p * 3 + 1] = FLOOR_Y + 0.015;
    }
    posAttr.needsUpdate = true;
    fx.dustPoints.material.opacity = 0.42 * (1 - t);

    if (t >= 1) {
      scene.remove(fx.dustPoints);
      fx.dustPoints.geometry.dispose();
      fx.dustPoints.material.dispose();
      state.placeImpactEffects.splice(i, 1);
    }
  }
}

function updateOrbitEnabled() {
  orbit.enabled = !state.lookMode && !state.isTransformDragging;
}

function updateCameraModeUi() {
  ui.viewportWrap.classList.toggle('camera-mode', state.lookMode);
  setStatus(state.lookMode ? 'Cam mode' : 'Cursor mode');
}

function syncLookAnglesFromCamera() {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  state.lookPitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  state.lookYaw = Math.atan2(dir.x, dir.z);
}

function updateCameraFromLookAngles() {
  const cosPitch = Math.cos(state.lookPitch);
  const dir = new THREE.Vector3(
    Math.sin(state.lookYaw) * cosPitch,
    Math.sin(state.lookPitch),
    Math.cos(state.lookYaw) * cosPitch,
  ).normalize();

  const target = camera.position.clone().addScaledVector(dir, 20);
  orbit.target.copy(target);
  camera.lookAt(target);
}

function enterLookMode() {
  if (state.lookMode) return;
  syncLookAnglesFromCamera();
  state.lookMode = true;
  state.lookLastX = null;
  state.lookLastY = null;
  updateOrbitEnabled();
  updateCameraModeUi();
}

function exitLookMode() {
  if (!state.lookMode) return;
  state.lookMode = false;
  state.lookLastX = null;
  state.lookLastY = null;
  updateOrbitEnabled();
  updateCameraModeUi();
}

function toggleLookMode() {
  if (state.lookMode) {
    exitLookMode();
  } else {
    enterLookMode();
  }
}

function renderCatalog() {
  ui.list.innerHTML = '';
  for (const obj of state.filtered.slice(0, 300)) {
    const button = document.createElement('button');
    const imageUrl = getObjectImageUrl(obj);
    const isActive = state.selectedCatalog?.objectName === obj.objectName || state.stickyCatalog?.objectName === obj.objectName;
    button.className = `object-item${isActive ? ' active' : ''}`;
    if (!obj.hasKnownDimensions) button.title = 'Dimensions unknown';
    button.draggable = true;
    button.innerHTML = `
      <img class="object-thumb" src="${imageUrl}" alt="${obj.objectName}" loading="lazy" />
      <span class="object-meta">
        <span class="object-name">${obj.objectName}</span>
        <span class="muted">${obj.category || '-'}</span><br>
        <span class="muted">${formatDim(obj.dimensionsVisual || [2.5, 2.5, 2.5])} m</span>
      </span>
    `;
    const thumb = button.querySelector('.object-thumb');
    thumb?.addEventListener('error', () => {
      thumb.style.opacity = '0.25';
    });
    button.addEventListener('click', () => {
      state.selectedCatalog = obj;
      setStickyCatalog(obj);
      renderCatalog();
      setStatus(`Placement armed: ${obj.objectName}. Move mouse over scene and click to place.`);
    });
    button.addEventListener('dragstart', (event) => {
      clearStickyCatalog();
      renderCatalog();
      state.dragCatalog = obj;
      event.dataTransfer?.setData('text/plain', obj.objectName);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    });
    button.addEventListener('dragend', () => {
      state.dragCatalog = null;
      ui.viewportWrap.classList.remove('drag-over');
    });
    ui.list.appendChild(button);
  }
}

function renderPlacedList() {
  if (!ui.placedList) return;
  ui.placedList.innerHTML = '';
  if (!state.placedObjects.length) {
    ui.placedList.innerHTML = '<div class="muted">No placed objects yet.</div>';
    return;
  }
  for (const obj of state.placedObjects) {
    const def = obj.userData.objectDef || {};
    const item = document.createElement('button');
    item.className = `placed-item${state.selectedPlaced === obj ? ' active' : ''}`;
    const label = document.createElement('span');
    label.className = 'placed-name';
    label.textContent = def.objectName || 'Unknown';
    const del = document.createElement('button');
    del.className = 'placed-delete';
    del.type = 'button';
    del.title = 'Delete object';
    del.setAttribute('aria-label', 'Delete object');
    del.textContent = '✕';
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      deletePlacedObject(obj);
    });
    item.appendChild(label);
    item.appendChild(del);
    item.addEventListener('click', () => setSelectedPlaced(obj));
    ui.placedList.appendChild(item);
  }
}

function deletePlacedObject(target) {
  if (!target) return;
  const deleted = target;
  const index = state.placedObjects.indexOf(deleted);
  if (index < 0) return;
  scene.remove(deleted);
  state.placedObjects = state.placedObjects.filter((o) => o !== deleted);
  pushUndo(() => {
    if (scene.children.includes(deleted)) return;
    scene.add(deleted);
    if (index >= 0 && index <= state.placedObjects.length) {
      state.placedObjects.splice(index, 0, deleted);
    } else {
      state.placedObjects.push(deleted);
    }
    setSelectedPlaced(deleted);
    renderPlacedList();
  });
  if (state.selectedPlaced === deleted) setSelectedPlaced(state.placedObjects[0] || null);
  renderPlacedList();
  schedulePersistPlacedObjects();
}

function updateSelectionOutlineStyles() {
  for (const placed of state.placedObjects) {
    const isSelected = placed === state.selectedPlaced;
    const solid = placed.children.find((c) => c.name === 'solid');
    const wire = placed.children.find((c) => c.name === 'wire');
    const centerNode = placed.children.find((c) => c.name === 'centerNode');

    if (wire?.material?.color) {
      wire.material.color.set(isSelected ? 0xffcc33 : 0x8dc2ff);
    }
    if (solid?.material) {
      solid.material.emissiveIntensity = isSelected ? 0.55 : 0.25;
      solid.material.opacity = isSelected ? 1 : 0.94;
    }
    if (centerNode) {
      centerNode.scale.setScalar(isSelected ? 1.35 : 1);
    }
  }
}

function filterCatalog() {
  const q = ui.search.value.trim().toLowerCase();
  state.filtered = !q
    ? state.catalog
    : state.catalog.filter((o) =>
      (o.objectName || '').toLowerCase().includes(q)
      || (o.inGameName || '').toLowerCase().includes(q)
      || (o.category || '').toLowerCase().includes(q)
      || (o.path || '').toLowerCase().includes(q)
    );
  renderCatalog();
}

function buildBoxMesh(objDef, dimsOverride = null) {
  const { dims, center } = normalizeBoxData(objDef);
  const finalDims = dimsOverride || dims;

  const holder = new THREE.Group();
  holder.userData.instanceId = state.nextInstanceId;
  state.nextInstanceId += 1;
  holder.userData.objectDef = objDef;
  holder.userData.dims = [...finalDims];
  holder.userData.center = [...center];

  const geom = new THREE.BoxGeometry(finalDims[0], finalDims[1], finalDims[2]);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x16324a,
    emissiveIntensity: 0.25,
    roughness: 0.72,
    metalness: 0.05,
    transparent: true,
    opacity: 0.94,
  });
  applyObjectImageTexture(mat, objDef);
  const solid = new THREE.Mesh(geom, mat);
  solid.name = 'solid';
  solid.castShadow = true;
  solid.receiveShadow = true;
  solid.position.set(center[0], center[1], center[2]);

  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(geom),
    new THREE.LineBasicMaterial({ color: 0x8dc2ff }),
  );
  wire.name = 'wire';
  wire.position.copy(solid.position);

  const centerNode = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 14, 14),
    new THREE.MeshStandardMaterial({
      color: 0xffcc66,
      emissive: 0xffa733,
      emissiveIntensity: 0.8,
      roughness: 0.35,
      metalness: 0.1,
    }),
  );
  centerNode.name = 'centerNode';
  centerNode.position.copy(solid.position);
  centerNode.castShadow = true;
  centerNode.receiveShadow = true;

  holder.add(solid);
  holder.add(wire);
  holder.add(centerNode);
  return holder;
}

function buildStickyPreview(objDef) {
  const preview = buildBoxMesh(objDef);
  preview.name = 'stickyPreview';
  preview.traverse((child) => {
    child.userData.noSelect = true;
    if (child.material) {
      child.material = child.material.clone();
      if (typeof child.material.opacity === 'number') child.material.opacity = 0.38;
      if (typeof child.material.transparent === 'boolean') child.material.transparent = true;
      if (typeof child.material.depthWrite === 'boolean') child.material.depthWrite = false;
    }
  });
  return preview;
}

function clearStickyCatalog() {
  state.stickyCatalog = null;
  if (state.stickyPreview) {
    scene.remove(state.stickyPreview);
    state.stickyPreview = null;
  }
}

function setStickyCatalog(objDef) {
  clearStickyCatalog();
  state.stickyCatalog = objDef;
  state.stickyPreview = buildStickyPreview(objDef);
  scene.add(state.stickyPreview);
}

function setPlacedDimensions(holder, dims) {
  const finalDims = dims.map((n) => Number(n) || 1);
  const center = holder.userData.center || [0, 0, 0];
  holder.userData.dims = [...finalDims];

  const solid = holder.children.find((c) => c.name === 'solid');
  const wire = holder.children.find((c) => c.name === 'wire');
  const centerNode = holder.children.find((c) => c.name === 'centerNode');
  if (!solid || !wire) return;

  const nextGeom = new THREE.BoxGeometry(finalDims[0], finalDims[1], finalDims[2]);
  const nextEdgeGeom = new THREE.EdgesGeometry(nextGeom);

  solid.geometry.dispose();
  wire.geometry.dispose();

  solid.geometry = nextGeom;
  wire.geometry = nextEdgeGeom;

  solid.position.set(center[0], center[1], center[2]);
  wire.position.copy(solid.position);
  if (centerNode) centerNode.position.copy(solid.position);
}

function applySnapshot(obj, snap) {
  obj.position.set(snap.position[0], snap.position[1], snap.position[2]);
  obj.rotation.set(snap.rotation[0], snap.rotation[1], snap.rotation[2]);
  obj.scale.set(snap.scale[0], snap.scale[1], snap.scale[2]);
  setPlacedDimensions(obj, snap.dims);
  clampPlacedAboveFloor(obj);
}

function placeAt(point, objDef, shouldTrackUndo = true) {
  const placed = buildBoxMesh(objDef);
  placed.position.set(
    Math.round(point.x * 4) / 4,
    FLOOR_Y,
    Math.round(point.z * 4) / 4,
  );
  clampPlacedAboveFloor(placed);
  scene.add(placed);
  state.placedObjects.push(placed);
  setSelectedPlaced(placed);
  renderPlacedList();
  spawnPlaceEdgeFlash(placed);
  spawnPlaceImpactEffect(placed);
  schedulePersistPlacedObjects();

  if (shouldTrackUndo) {
    pushUndo(() => {
      if (!scene.children.includes(placed)) return;
      scene.remove(placed);
      state.placedObjects = state.placedObjects.filter((o) => o !== placed);
      if (state.selectedPlaced === placed) setSelectedPlaced(state.placedObjects[0] || null);
      renderPlacedList();
    });
  }
}

function screenToGround(clientX, clientY) {
  const rect = ui.canvas.getBoundingClientRect();
  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  return raycaster.intersectObject(ground)[0] || null;
}

function setSelectedPlaced(obj) {
  state.selectedPlaced = obj;
  if (!obj) {
    transform.detach();
    setStatus('No object selected.');
    updateSelectionOutlineStyles();
    renderPlacedList();
    return;
  }
  transform.attach(obj);
  const def = obj.userData.objectDef;
  setStatus(`Selected: ${def.objectName} (${describeDimensionSource(def)})`);
  syncSelectionFields();
  updateSelectionOutlineStyles();
  renderPlacedList();
}

function syncSelectionFields() {
  // XYZ input controls removed from UI.
}

function inferEditorType(objDef) {
  return inferEditorModel(objDef);
}

function inferEditorModel(objDef) {
  const path = String(objDef.path || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  const modelName = String(objDef.objectName || 'unknown_object');
  const baseName = modelName.replace(/^.*[\\/]/, '');
  const fileName = baseName.endsWith('.p3d') ? baseName : `${baseName}.p3d`;
  const full = path ? `${path}/${fileName}` : fileName;
  return full.replace(/\//g, '\\');
}

function toDayzOrientation(rotation) {
  const yaw = THREE.MathUtils.radToDeg(rotation.y);
  const pitch = THREE.MathUtils.radToDeg(rotation.x);
  const roll = THREE.MathUtils.radToDeg(rotation.z);
  return [yaw, pitch, roll];
}

function fromDayzOrientation(orientation) {
  const yaw = THREE.MathUtils.degToRad(Number(orientation?.[0]) || 0);
  const pitch = THREE.MathUtils.degToRad(Number(orientation?.[1]) || 0);
  const roll = THREE.MathUtils.degToRad(Number(orientation?.[2]) || 0);
  return [pitch, yaw, roll];
}

function exportDayzEditorJson() {
  const out = state.placedObjects.map((o) => {
    const objDef = o.userData.objectDef || {};
    const type = inferEditorType(objDef);
    const scale = Number(o.scale.x) || 1;
    return {
      Type: type,
      DisplayName: type,
      Position: [o.position.x, o.position.y, o.position.z],
      Orientation: toDayzOrientation(o.rotation),
      Scale: scale,
      AttachmentMap: {},
      Model: inferEditorModel(objDef),
      Flags: 30,
    };
  });
  return out;
}

function downloadDayzEditorJson() {
  const out = exportDayzEditorJson();

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dayz-editor-export.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function copyDayzExportToClipboard() {
  const out = exportDayzEditorJson();
  const text = JSON.stringify(out, null, 2);

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    const original = ui.copyExport.textContent;
    ui.copyExport.textContent = 'Copied';
    setTimeout(() => {
      ui.copyExport.textContent = original;
    }, 1000);
  } catch {
    const original = ui.copyExport.textContent;
    ui.copyExport.textContent = 'Copy failed';
    setTimeout(() => {
      ui.copyExport.textContent = original;
    }, 1200);
  }
}

function exportSceneJson() {
  const out = state.placedObjects.map((o) => ({
    objectName: o.userData.objectDef.objectName,
    category: o.userData.objectDef.category || null,
    path: o.userData.objectDef.path || null,
    dimensionsVisual: o.userData.dims,
    centerOffset: o.userData.center,
    position: [o.position.x, o.position.y, o.position.z],
    rotationEuler: [o.rotation.x, o.rotation.y, o.rotation.z],
  }));

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dayz-box-scene.json';
  a.click();
  URL.revokeObjectURL(url);
}

function clearPlaced(shouldPersist = true) {
  for (const obj of state.placedObjects) scene.remove(obj);
  state.placedObjects = [];
  state.undoStack = [];
  setSelectedPlaced(null);
  renderPlacedList();
  if (shouldPersist) schedulePersistPlacedObjects();
}

function importSceneJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    alert('Invalid JSON file.');
    return;
  }
  if (!Array.isArray(data)) {
    alert('Scene file must be a JSON array.');
    return;
  }

  clearPlaced(false);

  for (const item of data) {
    const def = state.catalog.find((x) => x.objectName === item.objectName) || {
      objectName: item.objectName || 'Unknown',
      category: item.category || 'Imported',
      path: item.path || '-',
      dimensionsVisual: item.dimensionsVisual || [2.5, 2.5, 2.5],
      bboxMinVisual: null,
      bboxMaxVisual: null,
    };

    const placed = buildBoxMesh(def, item.dimensionsVisual);
    if (Array.isArray(item.position) && item.position.length === 3) {
      placed.position.set(item.position[0], item.position[1], item.position[2]);
    }
    if (Array.isArray(item.rotationEuler) && item.rotationEuler.length === 3) {
      placed.rotation.set(item.rotationEuler[0], item.rotationEuler[1], item.rotationEuler[2]);
    }
    clampPlacedAboveFloor(placed);
    scene.add(placed);
    state.placedObjects.push(placed);
  }

  if (state.placedObjects.length) {
    setSelectedPlaced(state.placedObjects[0]);
  }
  renderPlacedList();
  schedulePersistPlacedObjects();
}

function importDayzEditorJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    alert('Invalid JSON file.');
    return false;
  }
  if (!Array.isArray(data)) return false;
  if (!data.every((x) => x && typeof x === 'object' && ('Type' in x || 'Position' in x || 'Orientation' in x))) {
    return false;
  }

  clearPlaced(false);

  for (const item of data) {
    const typeName = String(item.Type || item.DisplayName || 'UnknownObject');
    const existing = state.catalog.find((x) => x.objectName === typeName || x.objectName === `${typeName}.p3d`);
    const def = existing || {
      objectName: typeName,
      category: 'Imported',
      path: '-',
      dimensionsVisual: [2.5, 2.5, 2.5],
      bboxMinVisual: null,
      bboxMaxVisual: null,
    };

    const placed = buildBoxMesh(def, def.dimensionsVisual);
    if (Array.isArray(item.Position) && item.Position.length === 3) {
      placed.position.set(Number(item.Position[0]) || 0, Number(item.Position[1]) || 0, Number(item.Position[2]) || 0);
    }
    if (Array.isArray(item.Orientation) && item.Orientation.length === 3) {
      const [rx, ry, rz] = fromDayzOrientation(item.Orientation);
      placed.rotation.set(rx, ry, rz);
    }
    clampPlacedAboveFloor(placed);
    scene.add(placed);
    state.placedObjects.push(placed);
  }

  if (state.placedObjects.length) {
    setSelectedPlaced(state.placedObjects[0]);
  }
  renderPlacedList();
  schedulePersistPlacedObjects();
  return true;
}

ui.canvas.addEventListener('pointerdown', (event) => {
  const rect = ui.canvas.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const placedHits = raycaster.intersectObjects(state.placedObjects, true);
  if (placedHits.length > 0) {
    let root = placedHits[0].object;
    while (root.parent && !state.placedObjects.includes(root)) root = root.parent;
    if (state.placedObjects.includes(root)) {
      setSelectedPlaced(root);
      clearStickyCatalog();
      renderCatalog();
      return;
    }
  }

  if (state.stickyCatalog) {
    const hit = screenToGround(event.clientX, event.clientY);
    if (!hit) return;
    const placedName = state.stickyCatalog.objectName || 'Object';
    placeAt(hit.point, state.stickyCatalog, true);
    clearStickyCatalog();
    renderCatalog();
    setStatus(`Placed: ${placedName}`);
  }
});

ui.canvas.addEventListener('pointermove', (event) => {
  if (!state.stickyCatalog || !state.stickyPreview) return;
  const hit = screenToGround(event.clientX, event.clientY);
  if (!hit) return;
  state.stickyPreview.position.set(
    Math.round(hit.point.x * 4) / 4,
    FLOOR_Y,
    Math.round(hit.point.z * 4) / 4,
  );
  clampPlacedAboveFloor(state.stickyPreview);
});

ui.viewportWrap.addEventListener('dragover', (event) => {
  if (!state.dragCatalog) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  ui.viewportWrap.classList.add('drag-over');
});

ui.viewportWrap.addEventListener('dragleave', (event) => {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    ui.viewportWrap.classList.remove('drag-over');
  }
});

ui.viewportWrap.addEventListener('drop', (event) => {
  if (!state.dragCatalog) return;
  event.preventDefault();
  ui.viewportWrap.classList.remove('drag-over');
  const hit = screenToGround(event.clientX, event.clientY);
  if (!hit) return;
  clearStickyCatalog();
  state.selectedCatalog = state.dragCatalog;
  placeAt(hit.point, state.dragCatalog, true);
  renderCatalog();
  state.dragCatalog = null;
});

document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => transform.setMode(button.dataset.mode));
});

ui.search.addEventListener('input', filterCatalog);

ui.exportScene.addEventListener('click', downloadDayzEditorJson);
ui.copyExport.addEventListener('click', copyDayzExportToClipboard);
ui.undoAction.addEventListener('click', undoLastAction);

ui.importScene.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const importedDayz = importDayzEditorJson(text);
  if (!importedDayz) {
    importSceneJson(text);
  }
  event.target.value = '';
});

ui.deleteSelected.addEventListener('click', () => {
  deletePlacedObject(state.selectedPlaced);
});

ui.duplicateSelected.addEventListener('click', () => {
  if (!state.selectedPlaced) return;
  const src = state.selectedPlaced;
  const objDef = src.userData.objectDef || {};
  const duplicate = buildBoxMesh(objDef, src.userData.dims || [2.5, 2.5, 2.5]);
  duplicate.position.copy(src.position).add(new THREE.Vector3(0.7, 0, 0.7));
  duplicate.rotation.copy(src.rotation);
  duplicate.scale.copy(src.scale);
  clampPlacedAboveFloor(duplicate);
  scene.add(duplicate);
  state.placedObjects.push(duplicate);
  setSelectedPlaced(duplicate);
  renderPlacedList();
  schedulePersistPlacedObjects();

  pushUndo(() => {
    if (!scene.children.includes(duplicate)) return;
    scene.remove(duplicate);
    state.placedObjects = state.placedObjects.filter((o) => o !== duplicate);
    if (state.selectedPlaced === duplicate) setSelectedPlaced(state.placedObjects[0] || null);
    renderPlacedList();
  });
});

function keyEventTargetsInput(event) {
  const target = event.target;
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

window.addEventListener('keydown', (event) => {
  if (keyEventTargetsInput(event)) return;
  const isUndo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z';
  if (isUndo) {
    event.preventDefault();
    undoLastAction();
    return;
  }

  if (event.key === 'Delete') {
    event.preventDefault();
    deletePlacedObject(state.selectedPlaced);
    return;
  }

  if (event.code === 'Space') {
    event.preventDefault();
    toggleLookMode();
    return;
  }

  const key = event.key.toLowerCase();
  if (key === 'shift') state.navKeys.shift = true;
  if (key in state.navKeys) {
    state.navKeys[key] = true;
    event.preventDefault();
  }
});

window.addEventListener('keyup', (event) => {
  const key = event.key.toLowerCase();
  if (key === 'shift') state.navKeys.shift = false;
  if (key in state.navKeys) {
    state.navKeys[key] = false;
  }
});

window.addEventListener('blur', () => {
  Object.keys(state.navKeys).forEach((k) => {
    state.navKeys[k] = false;
  });
  exitLookMode();
});

window.addEventListener('beforeunload', () => {
  persistPlacedObjectsNow();
});

ui.canvas.addEventListener('mouseleave', () => {
  state.lookLastX = null;
  state.lookLastY = null;
});

window.addEventListener('mousemove', (event) => {
  if (!state.lookMode) return;
  if (state.lookLastX == null || state.lookLastY == null) {
    state.lookLastX = event.clientX;
    state.lookLastY = event.clientY;
    return;
  }
  const sensitivity = 0.0024;
  const deltaX = event.clientX - state.lookLastX;
  const deltaY = event.clientY - state.lookLastY;
  state.lookLastX = event.clientX;
  state.lookLastY = event.clientY;
  state.lookYaw -= deltaX * sensitivity;
  state.lookPitch -= deltaY * sensitivity;
  state.lookPitch = THREE.MathUtils.clamp(state.lookPitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  updateCameraFromLookAngles();
});

async function loadCatalog() {
  let lastError = null;
  for (const source of catalogSources) {
    try {
      const res = await fetch(source, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      if (!Array.isArray(payload)) throw new Error('Catalog payload is not an array');

      state.catalog = payload.map(normalizeCatalogEntry);
      state.catalog.sort((a, b) => (a.objectName || '').localeCompare(b.objectName || ''));
      state.filtered = state.catalog;
      state.catalogSource = source;
      renderCatalog();
      const restoredCount = restorePlacedObjectsFromStorage();
      setStatus(
        restoredCount > 0
          ? `Loaded ${state.catalog.length.toLocaleString()} | Restored ${restoredCount}`
          : `Catalog loaded: ${state.catalog.length.toLocaleString()}`,
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }

  try {
    throw lastError || new Error('No catalog source could be loaded');
  } catch (error) {
    ui.list.innerHTML = '<div class="muted">Failed to load catalog from SamsObjectFinder API or local file.</div>';
    setStatus('Catalog load failed.');
    console.error('Catalog load failed:', error);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  pulseLight.intensity = pulseBaseIntensity + Math.sin(t * 1.4) * 0.22;
  pulseLight.position.x = Math.cos(t * 0.33) * 18;
  pulseLight.position.z = Math.sin(t * 0.33) * 18;
  pulseLight.position.y = 7 + Math.sin(t * 1.8) * 0.9;
  applyKeyboardNavigation(delta);
  updatePlaceEdgeEffects(delta);
  updatePlaceImpactEffects(delta);
  renderer.render(scene, camera);
}

renderPlacedList();
loadCatalog();
animate();
