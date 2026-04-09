import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';

export const vrmData = [
  {
    vrm: null, mixer: null, gltf: null,
    blinkWeight: 0, nextBlinkTime: 0,
    talkWeights: { A: 0, I: 0, U: 0, E: 0, O: 0 },
    nextTalkSwitchTime: 0, currentTalkTarget: 'A'
  },
  {
    vrm: null, mixer: null, gltf: null,
    blinkWeight: 0, nextBlinkTime: 0,
    talkWeights: { A: 0, I: 0, U: 0, E: 0, O: 0 },
    nextTalkSwitchTime: 0, currentTalkTarget: 'A'
  }
];

export let activeVrmIndex = 0;
export let currentStage = null;
let transformControl = null;

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
  const delta = clock.getDelta();
  
  vrmData.forEach((data, index) => {
    try {
      if (data.mixer) data.mixer.update(delta);
    } catch (e) {
      console.error(`VRM ${index} Animation error:`, e);
      data.mixer = null;
    }
    
    try {
      if (data.vrm) {
        updateAutoBlink(delta, data);
        updateAutoTalk(delta, data);
        
        // Target 1 or 2's specific settings can be overridden later, 
        // but for now lookAt targets camera globally.
        const isLookAtCamera = document.getElementById('look-at-camera').checked;
        if (data.vrm.lookAt) {
          data.vrm.lookAt.target = isLookAtCamera ? camera : null;
        }

        data.vrm.update(delta);
      }
    } catch (e) {
      console.warn(`VRM ${index} update error:`, e);
    }
  });

  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  const viewer = document.getElementById('viewer');
  camera.aspect = viewer.clientWidth / viewer.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewer.clientWidth, viewer.clientHeight);
});

// Target Switch UI
document.getElementById('target-vrm0').addEventListener('click', () => {
  activeVrmIndex = 0;
  document.getElementById('target-vrm0').classList.replace('btn', 'btn primary');
  if(document.getElementById('target-vrm1').classList.contains('primary')){
     document.getElementById('target-vrm1').classList.replace('btn primary', 'btn');
  }
  document.getElementById('target-vrm1').style.opacity = '0.6';
  document.getElementById('target-vrm0').style.opacity = '1';
  refreshTargetUI();
});
document.getElementById('target-vrm1').addEventListener('click', () => {
  activeVrmIndex = 1;
  document.getElementById('target-vrm1').classList.replace('btn', 'btn primary');
  if(document.getElementById('target-vrm0').classList.contains('primary')) {
     document.getElementById('target-vrm0').classList.replace('btn primary', 'btn');
  }
  document.getElementById('target-vrm0').style.opacity = '0.6';
  document.getElementById('target-vrm1').style.opacity = '1';
  refreshTargetUI();
});

// TransformControls Initialization
transformControl = new TransformControls(camera, renderer.domElement);
transformControl.addEventListener('dragging-changed', (event) => {
  controls.enabled = !event.value;
});
if (transformControl.getHelper) {
  scene.add(transformControl.getHelper());
} else {
  scene.add(transformControl);
}

document.getElementById('gizmo-translate').addEventListener('click', () => { transformControl.setMode('translate'); updateGizmoUI('gizmo-translate'); });
document.getElementById('gizmo-rotate').addEventListener('click', () => { transformControl.setMode('rotate'); updateGizmoUI('gizmo-rotate'); });
document.getElementById('gizmo-scale').addEventListener('click', () => { transformControl.setMode('scale'); updateGizmoUI('gizmo-scale'); });

function updateGizmoUI(activeId) {
  ['gizmo-translate', 'gizmo-rotate', 'gizmo-scale'].forEach(id => {
    document.getElementById(id).classList.remove('active');
    document.getElementById(id).style.borderColor = '';
  });
  document.getElementById(activeId).classList.add('active');
  document.getElementById(activeId).style.borderColor = 'var(--primary-color)';
}

document.getElementById('attach-vrm').addEventListener('click', () => {
  const target = vrmData[activeVrmIndex].vrm;
  if(target) transformControl.attach(target.scene);
  else alert("現在選択されているタブにVRMがロードされていません");
});
document.getElementById('attach-stage').addEventListener('click', () => {
  if(currentStage) transformControl.attach(currentStage);
  else alert("ステージがロードされていません");
});
document.getElementById('detach-gizmo').addEventListener('click', () => {
  transformControl.detach();
});

// Load handling
document.getElementById('vrm-upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  document.getElementById('loading').classList.remove('hidden');
  const url = URL.createObjectURL(file);

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  loader.load(url, (gltf) => {
    const data = vrmData[activeVrmIndex];
    if (data.vrm) {
      scene.remove(data.vrm.scene);
      data.vrm.dispose();
      if (data.mixer) {
        data.mixer.stopAllAction();
        data.mixer = null;
      }
    }

    data.gltf = gltf;
    data.vrm = gltf.userData.vrm;
    scene.add(data.vrm.scene);
    
    // Spread them out slightly by default if loading into slot 1
    if (activeVrmIndex === 1 && data.vrm.scene.position.x === 0) {
      data.vrm.scene.position.x = 0.5;
      if(vrmData[0].vrm && vrmData[0].vrm.scene.position.x === 0) {
        vrmData[0].vrm.scene.position.x = -0.5;
      }
    }

    data.vrm.scene.rotation.y = Math.PI; // Face the camera

    document.getElementById('editor-container').classList.remove('hidden');
    refreshTargetUI();
    document.getElementById('loading').classList.add('hidden');
    
    // reset input
    e.target.value = '';
    URL.revokeObjectURL(url);
  }, undefined, (err) => {
    console.error(err);
    alert("Error loading VRM");
    document.getElementById('loading').classList.add('hidden');
  });
});

function renderTabs() {
  const tabsContainer = document.getElementById('preset-tabs');
  tabsContainer.innerHTML = '';
  blendShapeGroups.forEach((group, index) => {
    const tab = document.createElement('div');
    tab.className = `tab ${index === currentPresetIndex ? 'active' : ''}`;
    tab.textContent = group.name || group.presetName;
    tab.onclick = () => selectPreset(index);
    tabsContainer.appendChild(tab);
  });
}

function selectPreset(index) {
  currentPresetIndex = index;
  const group = blendShapeGroups[index];
  currentPresetName = group.name || group.presetName;
  
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

  // Clear all morph targets on all mapped scene meshes
  Object.values(sceneMeshMap).forEach(meshArray => {
    meshArray.forEach(mesh => {
      if (mesh.morphTargetInfluences) {
        for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
          mesh.morphTargetInfluences[i] = 0;
        }
      }
    });
  });

  // Apply current group binds
  const group = blendShapeGroups[currentPresetIndex];
  if (!group || !group.binds) return;

  const previewRatio = previewAmount / 100;

  group.binds.forEach(bind => {
    const meshArray = sceneMeshMap[bind.mesh];
    if (meshArray) {
      meshArray.forEach(mesh => {
        if (mesh.morphTargetInfluences && bind.index < mesh.morphTargetInfluences.length) {
          // VRM 0.x weight is 0-100
          mesh.morphTargetInfluences[bind.index] += (bind.weight / 100) * previewRatio;
        }
      });
    }
  });

  // Apply Auto Blink if enabled
  const isAutoBlink = document.getElementById('auto-blink').checked;
  if (isAutoBlink && blinkWeight > 0) {
    const blinkGroup = blendShapeGroups.find(g => g.presetName === 'Blink' || g.name?.toUpperCase() === 'BLINK');
    if (blinkGroup && blinkGroup.binds) {
      blinkGroup.binds.forEach(bind => {
        const meshArray = sceneMeshMap[bind.mesh];
        if (meshArray) {
          meshArray.forEach(mesh => {
            if (mesh.morphTargetInfluences && bind.index < mesh.morphTargetInfluences.length) {
              const currentInf = mesh.morphTargetInfluences[bind.index];
              // まばたきを上から重ねる（最大1.0でクランプ）
              mesh.morphTargetInfluences[bind.index] = Math.min(1.0, currentInf + blinkWeight);
            }
          });
        }
      });
    }
  }

  // Apply Auto Talk if enabled
  const isAutoTalk = document.getElementById('auto-talk').checked;
  if (isAutoTalk) {
    ['A', 'I', 'U', 'E', 'O'].forEach(vowel => {
      const weight = talkWeights[vowel];
      if (weight > 0) {
        const talkGroup = blendShapeGroups.find(g => g.presetName === vowel || g.name?.toUpperCase() === vowel);
        if (talkGroup && talkGroup.binds) {
          talkGroup.binds.forEach(bind => {
            const meshArray = sceneMeshMap[bind.mesh];
            if (meshArray) {
              meshArray.forEach(mesh => {
                if (mesh.morphTargetInfluences && bind.index < mesh.morphTargetInfluences.length) {
                  const currentInf = mesh.morphTargetInfluences[bind.index];
                  mesh.morphTargetInfluences[bind.index] = Math.min(1.0, currentInf + weight);
                }
              });
            }
          });
        }
      }
    });
  }

  // Apply LookAt Expressions (for Expression-based LookAt models)
  // vrm.update() で計算された視線ウェイトを救出する
  const lookAtExps = ['lookUp', 'lookDown', 'lookLeft', 'lookRight'];
  lookAtExps.forEach(expName => {
    const weight = currentVRM.expressionManager.getValue(expName);
    if (weight > 0) {
      const talkGroup = blendShapeGroups.find(g => g.presetName === expName || (g.name && g.name.toLowerCase() === expName.toLowerCase()));
      if (talkGroup && talkGroup.binds) {
        talkGroup.binds.forEach(bind => {
          const meshArray = sceneMeshMap[bind.mesh];
          if (meshArray) {
            meshArray.forEach(mesh => {
              if (mesh.morphTargetInfluences && bind.index < mesh.morphTargetInfluences.length) {
                const currentInf = mesh.morphTargetInfluences[bind.index];
                mesh.morphTargetInfluences[bind.index] = Math.min(1.0, currentInf + weight);
              }
            });
          }
        });
      }
    }
  });
}

function updateAutoBlink(delta) {
  const isAutoBlink = document.getElementById('auto-blink').checked;
  if (!isAutoBlink) {
    blinkWeight = 0;
    return;
  }

  const now = performance.now() / 1000;
  if (now > nextBlinkTime) {
    // まばたき開始
    const blinkDuration = 0.2; // 全体で0.2秒
    const elapsed = now - nextBlinkTime;
    
    if (elapsed < blinkDuration) {
      // 三角波でまばたきを表現 (0 -> 1 -> 0)
      blinkWeight = Math.sin((elapsed / blinkDuration) * Math.PI);
    } else {
      // まばたき終了。次の時間をセット (2〜6秒後)
      blinkWeight = 0;
      nextBlinkTime = now + 2 + Math.random() * 4;
    }
  }
}

function updateAutoTalk(delta) {
  const isAutoTalk = document.getElementById('auto-talk').checked;
  if (!isAutoTalk) {
    Object.keys(talkWeights).forEach(k => talkWeights[k] = 0);
    return;
  }

  const now = performance.now() / 1000;
  
  if (now > nextTalkSwitchTime) {
    // 次の母音へ切り替え
    const vowels = ['A', 'I', 'U', 'E', 'O'];
    // 少し口を閉じる瞬間を入れるために、たまに空（無音）を混ぜる
    const nextOptions = [...vowels, null, null];
    const picked = nextOptions[Math.floor(Math.random() * nextOptions.length)];
    
    currentTalkTarget = picked;
    nextTalkSwitchTime = now + 0.1 + Math.random() * 0.2; // 0.1s - 0.3s ごとに切り替え
  }

  // なめらかに遷移
  const vowels = ['A', 'I', 'U', 'E', 'O'];
  vowels.forEach(v => {
    const target = (v === currentTalkTarget) ? 0.8 : 0; // 最大強度を少し抑えて0.8
    talkWeights[v] += (target - talkWeights[v]) * Math.min(1.0, delta * 15); // 線形補間
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

// Mixamo -> VRM 骨格マッピング (T-Poseを前提)
const mixamoVRMRigMap = {
  mixamorigHips: 'hips',
  mixamorigSpine: 'spine',
  mixamorigSpine1: 'chest',
  mixamorigSpine2: 'upperChest',
  mixamorigNeck: 'neck',
  mixamorigHead: 'head',
  mixamorigLeftShoulder: 'leftShoulder',
  mixamorigLeftArm: 'leftUpperArm',
  mixamorigLeftForeArm: 'leftLowerArm',
  mixamorigLeftHand: 'leftHand',
  mixamorigRightShoulder: 'rightShoulder',
  mixamorigRightArm: 'rightUpperArm',
  mixamorigRightForeArm: 'rightLowerArm',
  mixamorigRightHand: 'rightHand',
  mixamorigLeftUpLeg: 'leftUpperLeg',
  mixamorigLeftLeg: 'leftLowerLeg',
  mixamorigLeftFoot: 'leftFoot',
  mixamorigLeftToeBase: 'leftToes',
  mixamorigRightUpLeg: 'rightUpperLeg',
  mixamorigRightLeg: 'rightLowerLeg',
  mixamorigRightFoot: 'rightFoot',
  mixamorigRightToeBase: 'rightToes',
  // Fingers
  mixamorigLeftHandThumb1: 'leftThumbProximal',
  mixamorigLeftHandThumb2: 'leftThumbIntermediate',
  mixamorigLeftHandThumb3: 'leftThumbDistal',
  mixamorigLeftHandIndex1: 'leftIndexProximal',
  mixamorigLeftHandIndex2: 'leftIndexIntermediate',
  mixamorigLeftHandIndex3: 'leftIndexDistal',
  mixamorigLeftHandMiddle1: 'leftMiddleProximal',
  mixamorigLeftHandMiddle2: 'leftMiddleIntermediate',
  mixamorigLeftHandMiddle3: 'leftMiddleDistal',
  mixamorigLeftHandRing1: 'leftRingProximal',
  mixamorigLeftHandRing2: 'leftRingIntermediate',
  mixamorigLeftHandRing3: 'leftRingDistal',
  mixamorigLeftHandPinky1: 'leftLittleProximal',
  mixamorigLeftHandPinky2: 'leftLittleIntermediate',
  mixamorigLeftHandPinky3: 'leftLittleDistal',
  mixamorigRightHandThumb1: 'rightThumbProximal',
  mixamorigRightHandThumb2: 'rightThumbIntermediate',
  mixamorigRightHandThumb3: 'rightThumbDistal',
  mixamorigRightHandIndex1: 'rightIndexProximal',
  mixamorigRightHandIndex2: 'rightIndexIntermediate',
  mixamorigRightHandIndex3: 'rightIndexDistal',
  mixamorigRightHandMiddle1: 'rightMiddleProximal',
  mixamorigRightHandMiddle2: 'rightMiddleIntermediate',
  mixamorigRightHandMiddle3: 'rightMiddleDistal',
  mixamorigRightHandRing1: 'rightRingProximal',
  mixamorigRightHandRing2: 'rightRingIntermediate',
  mixamorigRightHandRing3: 'rightRingDistal',
  mixamorigRightHandPinky1: 'rightLittleProximal',
  mixamorigRightHandPinky2: 'rightLittleIntermediate',
  mixamorigRightHandPinky3: 'rightLittleDistal'
};

// Common BVH -> VRM Bone Mapping
const bvhVRMRigMap = {
  'Hips': 'hips',
  'Chest': 'spine',
  'Chest2': 'chest',
  'Neck': 'neck',
  'Head': 'head',
  'LeftCollar': 'leftShoulder',
  'LeftUpArm': 'leftUpperArm',
  'LeftLowArm': 'leftLowerArm',
  'LeftHand': 'leftHand',
  'RightCollar': 'rightShoulder',
  'RightUpArm': 'rightUpperArm',
  'RightLowArm': 'rightLowerArm',
  'RightHand': 'rightHand',
  'LeftUpLeg': 'leftUpperLeg',
  'LeftLowLeg': 'leftLowerLeg',
  'LeftFoot': 'leftFoot',
  'RightUpLeg': 'rightUpperLeg',
  'RightLowLeg': 'rightLowerLeg',
  'RightFoot': 'rightFoot',
  // Alternate lowercases for CMU formats
  'hips': 'hips',
  'spine': 'spine',
  'chest': 'chest',
  'neck': 'neck',
  'head': 'head',
  'leftShoulder': 'leftShoulder',
  'leftUpArm': 'leftUpperArm',
  'leftLowArm': 'leftLowerArm',
  'leftHand': 'leftHand',
  'rightShoulder': 'rightShoulder',
  'rightUpArm': 'rightUpperArm',
  'rightLowArm': 'rightLowerArm',
  'rightHand': 'rightHand',
  'leftUpLeg': 'leftUpperLeg',
  'leftLowLeg': 'leftLowerLeg',
  'leftFoot': 'leftFoot',
  'rightUpLeg': 'rightUpperLeg',
  'rightLowLeg': 'rightLowerLeg',
  'rightFoot': 'rightFoot',
  
  // MMD English Base (VMD to BVH converted)
  'Upper body': 'spine',
  'Upper body2': 'chest',
  'Lower body': 'hips',
  'Left shoulder': 'leftShoulder',
  'Left arm': 'leftUpperArm',
  'Left elbow': 'leftLowerArm',
  'Left wrist': 'leftHand',
  'Right shoulder': 'rightShoulder',
  'Right arm': 'rightUpperArm',
  'Right elbow': 'rightLowerArm',
  'Right wrist': 'rightHand',
  'Left leg': 'leftUpperLeg',
  'Left knee': 'leftLowerLeg',
  'Left ankle': 'leftFoot',
  'Right leg': 'rightUpperLeg',
  'Right knee': 'rightLowerLeg',
  'Right ankle': 'rightFoot',

  // Blender / AutoRig / Mixamo
  'LeftArm': 'leftUpperArm',
  'LeftForeArm': 'leftLowerArm',
  'RightArm': 'rightUpperArm',
  'RightForeArm': 'rightLowerArm',
  'LeftThigh': 'leftUpperLeg',
  'LeftCalf': 'leftLowerLeg',
  'RightThigh': 'rightUpperLeg',
  'RightCalf': 'rightLowerLeg',
  'L_UpperArm': 'leftUpperArm',
  'L_LowerArm': 'leftLowerArm',
  'L_Hand': 'leftHand',
  'R_UpperArm': 'rightUpperArm',
  'R_LowerArm': 'rightLowerArm',
  'R_Hand': 'rightHand',
  'L_Thigh': 'leftUpperLeg',
  'L_Calf': 'leftLowerLeg',
  'L_Foot': 'leftFoot',
  'R_Thigh': 'rightUpperLeg',
  'R_Calf': 'rightLowerLeg',
  'R_Foot': 'rightFoot'
};

function loadFbxFromUrl(url, onComplete) {
  const data = vrmData[activeVrmIndex];
  if (!data.vrm) {
    alert("Please load a VRM file first.");
    return;
  }
  document.getElementById('loading').classList.remove('hidden');

  const loader = new FBXLoader();
  loader.load(url, (fbx) => {
    const clip = THREE.AnimationClip.findByName(fbx.animations, 'mixamo.com') || fbx.animations[0];
    if (clip) {
      const tracks = [];
      const restRotationInverse = new THREE.Quaternion();
      const parentRestWorldRotation = new THREE.Quaternion();
      const _quatA = new THREE.Quaternion();

      const mixamoHips = fbx.getObjectByName('mixamorigHips');
      const motionHipsHeight = mixamoHips ? mixamoHips.position.y : 1;
      const vrmHipsHeight = data.vrm.humanoid.normalizedRestPose.hips ? data.vrm.humanoid.normalizedRestPose.hips.position[1] : 1;
      const hipsPositionScale = vrmHipsHeight / motionHipsHeight;

      clip.tracks.forEach((track) => {
        const trackSplits = track.name.split('.');
        const mixamoRigName = trackSplits[0];
        const propertyName = trackSplits[1];
        const vrmBoneName = mixamoVRMRigMap[mixamoRigName];
        const mixamoRigNode = fbx.getObjectByName(mixamoRigName);
        
        if (vrmBoneName && mixamoRigNode) {
          const vrmNodeName = data.vrm.humanoid.getNormalizedBoneNode(vrmBoneName)?.name;
          if (vrmNodeName) {
            
            mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
            mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation);

            if (track instanceof THREE.QuaternionKeyframeTrack) {
              for (let i = 0; i < track.values.length; i += 4) {
                const flatQuaternion = track.values.slice(i, i + 4);
                _quatA.fromArray(flatQuaternion);
                _quatA.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
                _quatA.toArray(flatQuaternion);

                flatQuaternion.forEach((v, index) => {
                  track.values[index + i] = v;
                });
              }

              tracks.push(
                new THREE.QuaternionKeyframeTrack(
                  `${vrmNodeName}.${propertyName}`,
                  track.times,
                  track.values.map((v, i) => (i % 2 === 0 ? -v : v))
                )
              );
            } else if (track instanceof THREE.VectorKeyframeTrack && propertyName === 'position') {
              const isInPlace = document.getElementById('anim-inplace').checked;
              const value = track.values.map((v, i) => {
                const axis = i % 3;
                if (isInPlace && (axis === 0 || axis === 2)) return 0;
                return (axis !== 1 ? -v : v) * hipsPositionScale;
              });
              tracks.push(new THREE.VectorKeyframeTrack(`${vrmNodeName}.${propertyName}`, track.times, value));
            }
          }
        }
      });

      const retargetedClip = new THREE.AnimationClip('vrmAnimation', clip.duration, tracks);
      
      if (data.mixer) {
        data.mixer.stopAllAction();
      }
      data.mixer = new THREE.AnimationMixer(data.vrm.scene);
      
      data.mixer.addEventListener('loop', () => {
        if (data.vrm && data.vrm.springBoneManager) {
          data.vrm.springBoneManager.reset();
        }
      });

      const action = data.mixer.clipAction(retargetedClip);
      action.play();
      if (onComplete) onComplete();
    } else {
      alert("No animations found in the FBX file.");
    }
    document.getElementById('loading').classList.add('hidden');
  }, undefined, (err) => {
    console.error(err);
    alert('Failed to load FBX Animation');
    document.getElementById('loading').classList.add('hidden');
    if (onComplete) onComplete();
  });
}

// Preset animation auto-loading using Vite import.meta.glob
// 拡張子.fbx, .bvh を対象に glob できるように修正 (任意)
const presetAnimations = import.meta.glob(['../animation/*.fbx', '../animation/*.bvh'], { query: '?url', import: 'default', eager: true });
const animSelect = document.getElementById('preset-anim-select');

// Build UI options for Vite presets
Object.keys(presetAnimations).forEach(path => {
  const filename = path.split('/').pop().replace(/\.(fbx|bvh)$/i, '');
  const option = document.createElement('option');
  option.value = presetAnimations[path];
  option.textContent = filename;
  animSelect.appendChild(option);
});

// --- IndexedDB Local Library ---
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("VRMToolDB", 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("animations")) {
        db.createObjectStore("animations", { keyPath: "name" });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveAnimToDB(file) {
  try {
    const db = await openDB();
    const tx = db.transaction("animations", "readwrite");
    const store = tx.objectStore("animations");
    const ext = file.name.split('.').pop().toLowerCase();
    store.put({ name: file.name, file: file, ext: ext });
    
    // Add to UI if not existing
    const existingOption = Array.from(animSelect.options).find(opt => opt.value === `db://${file.name}`);
    if (!existingOption) {
      const option = document.createElement('option');
      option.value = `db://${file.name}`;
      option.textContent = `[Saved] ${file.name}`;
      animSelect.appendChild(option);
      // Select the newly added item
      animSelect.value = option.value;
    }
  } catch (err) {
    console.warn("Failed to save to IndexedDB:", err);
  }
}

async function loadSavedAnimsToUI() {
  try {
    const db = await openDB();
    const tx = db.transaction("animations", "readonly");
    const store = tx.objectStore("animations");
    const req = store.getAll();
    req.onsuccess = () => {
      req.result.forEach(item => {
        const option = document.createElement('option');
        option.value = `db://${item.name}`;
        option.textContent = `[Saved] ${item.name}`;
        animSelect.appendChild(option);
      });
    };
  } catch (err) {
    console.warn("Failed to load IndexedDB items:", err);
  }
}

async function getAnimFromDB(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("animations", "readonly");
    const req = tx.objectStore("animations").get(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteAnimFromDB(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("animations", "readwrite");
    const req = tx.objectStore("animations").delete(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Call init IDB on page load
loadSavedAnimsToUI();

// UI elements mapping
const deleteAnimBtn = document.getElementById('delete-anim-btn');

// Dropdown change listener
animSelect.addEventListener('change', async (e) => {
  const value = e.target.value;
  
  // 削除ボタンの表示切り替え（[Saved]のアニメの場合のみ表示）
  if (value && value.startsWith('db://')) {
    deleteAnimBtn.style.display = 'inline-block';
  } else {
    deleteAnimBtn.style.display = 'none';
  }

  if (!value) return;
  
  // reset file input
  document.getElementById('fbx-upload').value = '';
  document.getElementById('bvh-upload').value = '';
  
  if (value.startsWith('db://')) {
    const filename = value.replace('db://', '');
    const data = await getAnimFromDB(filename);
    if (data && data.file) {
      const url = URL.createObjectURL(data.file);
      if (data.ext === 'bvh') {
        loadBvhFromUrl(url, () => URL.revokeObjectURL(url));
      } else {
        loadFbxFromUrl(url, () => URL.revokeObjectURL(url));
      }
    } else {
      alert("Saved file not found.");
    }
  } else {
    // Vite preset
    const ext = value.split('.').pop().split('?')[0].toLowerCase();
    if (ext === 'bvh') {
       loadBvhFromUrl(value);
    } else {
       loadFbxFromUrl(value);
    }
  }
});

// 削除ボタンリスナー
deleteAnimBtn.addEventListener('click', async () => {
  const value = animSelect.value;
  if (value && value.startsWith('db://')) {
    const filename = value.replace('db://', '');
    if (confirm(`保存されたアニメーション「${filename}」を削除しますか？`)) {
      await deleteAnimFromDB(filename);
      // ドロップダウンから削除
      const optionToRemove = Array.from(animSelect.options).find(opt => opt.value === value);
      if (optionToRemove) optionToRemove.remove();
      
      // 未選択に戻す
      animSelect.value = '';
      deleteAnimBtn.style.display = 'none';
    }
  }
});

document.getElementById('fbx-upload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const data = vrmData[activeVrmIndex];
  if (!file || !data.vrm) {
    if (!data.vrm) alert("Please load a VRM file first.");
    e.target.value = '';
    return;
  }
  
  await saveAnimToDB(file);
  
  const url = URL.createObjectURL(file);
  loadFbxFromUrl(url, () => URL.revokeObjectURL(url));
});

document.getElementById('bvh-upload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const data = vrmData[activeVrmIndex];
  if (!file || !data.vrm) {
    if (!data.vrm) alert("Please load a VRM file first.");
    e.target.value = '';
    return;
  }

  await saveAnimToDB(file);

  const url = URL.createObjectURL(file);
  loadBvhFromUrl(url, () => URL.revokeObjectURL(url));
});

function loadBvhFromUrl(url, onComplete) {
  const data = vrmData[activeVrmIndex];
  if (!data.vrm) {
    alert("Please load a VRM file first.");
    return;
  }
  document.getElementById('loading').classList.remove('hidden');

  const loader = new BVHLoader();
  loader.load(url, (bvh) => {
    const clip = bvh.clip;
    const skeleton = bvh.skeleton;
    if (clip && skeleton) {
      skeleton.bones[0].updateMatrixWorld(true);

      const tracks = [];
      const restRotationInverse = new THREE.Quaternion();
      const parentRestWorldRotation = new THREE.Quaternion();
      const _quatA = new THREE.Quaternion();

      const bvhHips = skeleton.bones.find(b => b.name === 'Hips' || b.name === 'hips');
      const motionHipsHeight = bvhHips ? bvhHips.position.y : 1; 
      const vrmHipsHeight = data.vrm.humanoid.normalizedRestPose.hips ? data.vrm.humanoid.normalizedRestPose.hips.position[1] : 1;
      const hipsPositionScale = motionHipsHeight > 0.001 ? vrmHipsHeight / motionHipsHeight : 1.0;

      clip.tracks.forEach((track) => {
        const trackSplits = track.name.split('.');
        if (trackSplits.length < 2) return;
        const bvhRigName = trackSplits[0];
        const propertyName = trackSplits[1];
        
        let vrmBoneName = bvhVRMRigMap[bvhRigName];
        
        if (!vrmBoneName) {
           const normalizedName = bvhRigName.toLowerCase().replace(/[^a-z0-9]/g, '');
           const allVrmBones = Array.from(new Set([
             ...Object.values(mixamoVRMRigMap), 
             ...Object.values(bvhVRMRigMap),
             'upperChest', 'leftEye', 'rightEye'
           ]));
           
           const directMatch = allVrmBones.find(v => v.toLowerCase() === normalizedName);
           if (directMatch) {
             vrmBoneName = directMatch;
           } else {
             const foundKey = Object.keys(bvhVRMRigMap).find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedName);
             if (foundKey) vrmBoneName = bvhVRMRigMap[foundKey];
           }
        }

        const bvhRigNode = skeleton.bones.find(b => b.name === bvhRigName);
        
        if (vrmBoneName && bvhRigNode) {
          const vrmNodeName = data.vrm.humanoid.getNormalizedBoneNode(vrmBoneName)?.name;
          if (vrmNodeName) {
            
            bvhRigNode.getWorldQuaternion(restRotationInverse).invert();
            if (bvhRigNode.parent && bvhRigNode.parent.isBone) {
              bvhRigNode.parent.getWorldQuaternion(parentRestWorldRotation);
            } else {
              parentRestWorldRotation.identity();
            }

            if (track instanceof THREE.QuaternionKeyframeTrack) {
              for (let i = 0; i < track.values.length; i += 4) {
                const flatQuaternion = track.values.slice(i, i + 4);
                _quatA.fromArray(flatQuaternion);
                _quatA.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
                _quatA.toArray(flatQuaternion);
                flatQuaternion.forEach((v, index) => { track.values[index + i] = v; });
              }

              tracks.push(
                new THREE.QuaternionKeyframeTrack(
                  `${vrmNodeName}.${propertyName}`, track.times, track.values.map((v, i) => (i % 2 === 0 ? -v : v))
                )
              );
            } else if (track instanceof THREE.VectorKeyframeTrack && propertyName === 'position') {
              const isInPlace = document.getElementById('anim-inplace').checked;
              const value = track.values.map((v, i) => {
                const axis = i % 3;
                if (isInPlace && (axis === 0 || axis === 2)) return 0;
                return (axis !== 1 ? -v : v) * hipsPositionScale;
              });
              tracks.push(new THREE.VectorKeyframeTrack(`${vrmNodeName}.${propertyName}`, track.times, value));
            }
          }
        }
      });
      
      const retargetedClip = new THREE.AnimationClip('vrmAnimationBvh', clip.duration, tracks);
      
      if (data.mixer) {
        data.mixer.stopAllAction();
      }
      data.mixer = new THREE.AnimationMixer(data.vrm.scene);
      
      data.mixer.addEventListener('loop', () => {
        if (data.vrm && data.vrm.springBoneManager) {
          data.vrm.springBoneManager.reset();
        }
      });

      const action = data.mixer.clipAction(retargetedClip);
      action.play();
      if (onComplete) onComplete();
    } else {
      alert("No valid BVH motion found.");
    }
    document.getElementById('loading').classList.add('hidden');
  }, undefined, (err) => {
    console.error(err);
    alert('Failed to load BVH Motion');
    document.getElementById('loading').classList.add('hidden');
    if (onComplete) onComplete();
  });
}

// Stage Loading
document.getElementById('stage-upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  document.getElementById('loading').classList.remove('hidden');
  const url = URL.createObjectURL(file);
  const ext = file.name.split('.').pop().toLowerCase();

  const handleStageLoad = (stageObject) => {
    if (currentStage) {
      scene.remove(currentStage);
      // メモリ解放（必要最低限）
      currentStage.traverse((child) => {
        if (child.isMesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
    }

    currentStage = stageObject;
    
    // ライトの情報を保持しつつデフォルトを暗くする
    currentStage.traverse((child) => {
      if (child.isLight) {
        // FBX経由のライトは強度が1000等の異常値になりがちなため元値を記憶
        child.userData.originalIntensity = child.intensity;
        // デフォルトでスライダー値(5)に基づき0.05倍に減衰
        child.intensity = child.userData.originalIntensity * 0.05; 
      }
    });

    scene.add(currentStage);
    
    // スライダーのリセット
    document.getElementById('stage-scale').value = 100;
    document.getElementById('stage-scale-val').textContent = 100;
    document.getElementById('stage-y').value = 0;
    document.getElementById('stage-y-val').textContent = "0.00";
    document.getElementById('stage-light').value = 5;
    document.getElementById('stage-light-val').textContent = "1.0";
    currentStage.scale.set(1, 1, 1);
    currentStage.position.set(0, 0, 0);

    // UI表示
    document.getElementById('stage-controls').classList.remove('hidden');
    document.getElementById('loading').classList.add('hidden');
    URL.revokeObjectURL(url);
  };

  const throwError = (err) => {
    console.error(err);
    alert('Failed to load stage.');
    document.getElementById('loading').classList.add('hidden');
    URL.revokeObjectURL(url);
  };

  if (ext === 'fbx') {
    const loader = new FBXLoader();
    loader.load(url, handleStageLoad, undefined, throwError);
  } else if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader();
    loader.load(url, (gltf) => handleStageLoad(gltf.scene), undefined, throwError);
  } else {
    alert("Unsupported stage format. Please use FBX or GLB/GLTF.");
    document.getElementById('loading').classList.add('hidden');
  }
});

// Stage Option Sliders
document.getElementById('stage-light').addEventListener('input', (e) => {
  // slider: 0 ~ 100. (5 = 1.0x default modifier, 100 = 20.0x modifier)
  const val = Number(e.target.value);
  const displayMultiplier = (val / 5).toFixed(1);
  document.getElementById('stage-light-val').textContent = displayMultiplier;
  
  if (currentStage) {
    const intensityMultiplier = val * 0.01; // val=5 -> 0.05
    currentStage.traverse(child => {
      if (child.isLight && child.userData.originalIntensity !== undefined) {
        child.intensity = child.userData.originalIntensity * intensityMultiplier;
      }
    });
  }
});
