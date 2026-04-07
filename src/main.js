import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { GLBEditor } from './glbParser.js';

let currentVRM = null;
let currentGLTF = null;
let gltfParser = null;
let glbEditor = null;
let blendShapeGroups = [];
let meshesWithTargets = [];
let currentPresetName = '';
let currentPresetIndex = 0;
let previewAmount = 100;

// Mapping array: index -> Three.js Mesh object
let meshIndexToThreeMesh = {};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20.0);
camera.position.set(0.0, 1.4, 2.0);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('main-canvas'), alpha: true, antialias: true });
renderer.setSize(document.getElementById('viewer').clientWidth, document.getElementById('viewer').clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0.0, 1.4, 0.0);
controls.update();

const light = new THREE.DirectionalLight(0xffffff, Math.PI);
light.position.set(1.0, 1.0, 1.0).normalize();
scene.add(light);
const ambient = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambient);

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const deltaTime = clock.getDelta();
  if (currentVRM) {
    currentVRM.update(deltaTime);
  }
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  const viewer = document.getElementById('viewer');
  camera.aspect = viewer.clientWidth / viewer.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewer.clientWidth, viewer.clientHeight);
});

// Load handling
document.getElementById('vrm-upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    document.getElementById('loading').classList.remove('hidden');
    try {
      glbEditor = new GLBEditor(reader.result);
      
      const vrmBlob = new Blob([reader.result], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(vrmBlob);

      const loader = new GLTFLoader();
      loader.register((parser) => {
        gltfParser = parser;
        return new VRMLoaderPlugin(parser);
      });

      loader.load(url, async (gltf) => {
        if (currentVRM) {
          scene.remove(currentVRM.scene);
          currentVRM.dispose();
        }

        currentGLTF = gltf;
        currentVRM = gltf.userData.vrm;
        scene.add(currentVRM.scene);
        currentVRM.scene.rotation.y = Math.PI; // Face the camera

        // Disable automatic VRM 0.x expression blinking if any
        if (currentVRM.expressionManager && currentVRM.expressionManager.blink) {
          currentVRM.expressionManager.blink.update = () => {};
        }

        console.log("=== Debug Info ===");
        console.log("Raw GLTF JSON Extensions:", currentGLTF.parser.json.extensions);
        blendShapeGroups = glbEditor.getBlendShapeGroups();
        console.log("BlendShape Groups extracted:", blendShapeGroups);

        meshesWithTargets = glbEditor.getMeshesWithMorphTargets();

        if (blendShapeGroups.length === 1) {
            alert(`BlendShapeGroupが1つしか見つかりませんでした。コンソール(F12)にてVRMタグの内容を確認してください。\n検出された拡張: ${JSON.stringify(Object.keys(currentGLTF.parser.json.extensions || {}))}`);
        }
        
        // Resolve Three.js meshes
        meshIndexToThreeMesh = {};
        for (const meta of meshesWithTargets) {
          const meshObj = await gltfParser.getDependency('mesh', meta.index);
          // meshObj might be a Group if there are multiple primitives. 
          // Bind targets in VRM apply to the primitives that have targets.
          // For simplicity we store the meshObj and handle groups in `applyPreview`
          meshIndexToThreeMesh[meta.index] = meshObj;
        }

        document.getElementById('vrm-download').disabled = false;
        document.getElementById('editor-container').classList.remove('hidden');

        renderTabs();
        if (blendShapeGroups.length > 0) {
          selectPreset(0);
        }

        document.getElementById('loading').classList.add('hidden');
      });

    } catch (err) {
      console.error(err);
      alert("Error loading VRM");
      document.getElementById('loading').classList.add('hidden');
    }
  };
  reader.readAsArrayBuffer(file);
});

function renderTabs() {
  const tabsContainer = document.getElementById('preset-tabs');
  tabsContainer.innerHTML = '';
  blendShapeGroups.forEach((group, index) => {
    const tab = document.createElement('div');
    tab.className = `tab ${index === currentPresetIndex ? 'active' : ''}`;
    tab.textContent = group.presetName || group.name;
    tab.onclick = () => selectPreset(index);
    tabsContainer.appendChild(tab);
  });
}

function selectPreset(index) {
  currentPresetIndex = index;
  const group = blendShapeGroups[index];
  currentPresetName = group.presetName || group.name;
  
  document.getElementById('current-preset-name').textContent = `Preset: ${currentPresetName}`;
  Array.from(document.getElementById('preset-tabs').children).forEach((tab, i) => {
    if (i === index) tab.classList.add('active');
    else tab.classList.remove('active');
  });

  renderSliders(group);
  applyPreview();
}

function renderSliders(group) {
  const container = document.getElementById('mesh-targets');
  container.innerHTML = '';

  meshesWithTargets.forEach(meshMeta => {
    const meshGroupDiv = document.createElement('div');
    meshGroupDiv.className = 'mesh-group';
    
    const h3 = document.createElement('h3');
    h3.textContent = meshMeta.name;
    meshGroupDiv.appendChild(h3);

    meshMeta.targetNames.forEach((targetName, targetIndex) => {
      // Find if this group has a bind for this mesh & target
      const bind = group.binds ? group.binds.find(b => b.mesh === meshMeta.index && b.index === targetIndex) : null;
      const initialValue = bind ? bind.weight : 0;

      const itemDiv = document.createElement('div');
      itemDiv.className = 'target-item';

      const headerDiv = document.createElement('div');
      headerDiv.className = 'target-item-header';
      headerDiv.innerHTML = `<span>${targetName}</span><span>${initialValue}</span>`;
      
      const sliderDiv = document.createElement('div');
      sliderDiv.className = 'target-slider';
      
      const input = document.createElement('input');
      input.type = 'range';
      input.min = 0;
      input.max = 100;
      input.value = initialValue;

      const numberEntry = document.createElement('input');
      numberEntry.type = 'number';
      numberEntry.min = 0;
      numberEntry.max = 100;
      numberEntry.value = initialValue;

      const updateValue = (val) => {
        val = Math.max(0, Math.min(100, val));
        input.value = val;
        numberEntry.value = val;
        headerDiv.children[1].textContent = val;
        
        // Update the JSON bind
        if (!group.binds) group.binds = [];
        
        const existingBindIndex = group.binds.findIndex(b => b.mesh === meshMeta.index && b.index === targetIndex);
        if (val === 0) {
          if (existingBindIndex >= 0) {
            group.binds.splice(existingBindIndex, 1);
          }
        } else {
          if (existingBindIndex >= 0) {
            group.binds[existingBindIndex].weight = val;
          } else {
            group.binds.push({ mesh: meshMeta.index, index: targetIndex, weight: val });
          }
        }
        applyPreview();
      };

      input.oninput = (e) => updateValue(parseInt(e.target.value, 10));
      numberEntry.onchange = (e) => updateValue(parseInt(e.target.value, 10));

      sliderDiv.appendChild(input);
      sliderDiv.appendChild(numberEntry);
      
      itemDiv.appendChild(headerDiv);
      itemDiv.appendChild(sliderDiv);
      meshGroupDiv.appendChild(itemDiv);
    });

    container.appendChild(meshGroupDiv);
  });
}

document.getElementById('preview-amount').addEventListener('input', (e) => {
  previewAmount = parseInt(e.target.value, 10);
  document.getElementById('preview-val').textContent = previewAmount;
  applyPreview();
});

function applyPreview() {
  if (!currentVRM || blendShapeGroups.length === 0) return;

  // Clear all morph targets first
  Object.values(meshIndexToThreeMesh).forEach(obj => {
    obj.traverse((child) => {
      if (child.isMesh && child.morphTargetInfluences) {
        for (let i = 0; i < child.morphTargetInfluences.length; i++) {
          child.morphTargetInfluences[i] = 0;
        }
      }
    });
  });

  // Apply current group binds
  const group = blendShapeGroups[currentPresetIndex];
  if (!group || !group.binds) return;

  const previewRatio = previewAmount / 100;

  group.binds.forEach(bind => {
    const obj = meshIndexToThreeMesh[bind.mesh];
    if (obj) {
      obj.traverse((child) => {
        if (child.isMesh && child.morphTargetInfluences && bind.index < child.morphTargetInfluences.length) {
          // Weight in VRM 0.0 is 0-100 or 0-1 depending on some exporters, but usually 0-100.
          // Vroid Studio uses 0-100.
          child.morphTargetInfluences[bind.index] = (bind.weight / 100) * previewRatio;
        }
      });
    }
  });
}

document.getElementById('vrm-download').addEventListener('click', () => {
  if (!glbEditor) return;
  document.getElementById('loading').classList.remove('hidden');

  setTimeout(() => {
    try {
      // Sync groups to editor
      glbEditor.setBlendShapeGroups(blendShapeGroups);
      
      // Rebuild ArrayBuffer
      const outBuffer = glbEditor.build();
      
      const blob = new Blob([outBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'modified_blendshape.vrm';
      a.click();
      URL.revokeObjectURL(url);
    } catch(err) {
      console.error(err);
      alert("Error occurred during export");
    }
    document.getElementById('loading').classList.add('hidden');
  }, 100);
});
