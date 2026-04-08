import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { GLBEditor } from './glbParser.js';

let currentVRM = null;
let currentGLTF = null;
let glbEditor = null;
let blendShapeGroups = [];
let meshesWithTargets = [];
let currentPresetName = '';
let currentPresetIndex = 0;
let previewAmount = 100;
let currentMixer = null;
let blinkWeight = 0;
let nextBlinkTime = 0;
let talkWeights = { A: 0, I: 0, U: 0, E: 0, O: 0 };
let nextTalkSwitchTime = 0;
let currentTalkTarget = 'A';

// Mapping: glTF mesh index -> array of Three.js SkinnedMesh objects found in the scene
let sceneMeshMap = {};

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
  
  if (currentMixer) {
    currentMixer.update(delta);
  }
  
  if (currentVRM) {
    updateAutoBlink(delta);
    updateAutoTalk(delta);
    
    // 視線追従の設定
    const isLookAtCamera = document.getElementById('look-at-camera').checked;
    currentVRM.lookAt.target = isLookAtCamera ? camera : null;

    currentVRM.update(delta); // SpringBones / LookAt 等の物理演算を更新
    applyPreview(); // 表情のエディタ用の強制的上書き
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

        blendShapeGroups = glbEditor.getBlendShapeGroups();
        meshesWithTargets = glbEditor.getMeshesWithMorphTargets();

        console.log("=== Debug Info ===");
        console.log("BlendShape Groups:", blendShapeGroups);
        console.log("Meshes with morph targets:", meshesWithTargets);

        // Build sceneMeshMap perfectly by asking GLTFLoader parser for the exact mesh index
        sceneMeshMap = {};
        for (const meta of meshesWithTargets) {
          sceneMeshMap[meta.index] = [];
          try {
            const obj = await currentGLTF.parser.getDependency('mesh', meta.index);
            if (obj) {
              if (obj.isGroup) {
                obj.traverse(child => {
                  if ((child.isMesh || child.isSkinnedMesh) && child.morphTargetInfluences) {
                    sceneMeshMap[meta.index].push(child);
                  }
                });
              } else if ((obj.isMesh || obj.isSkinnedMesh) && obj.morphTargetInfluences) {
                sceneMeshMap[meta.index].push(obj);
              }
            }
          } catch(e) {
            console.warn(`Could not get mesh index ${meta.index} from parser`, e);
          }
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
      alert("Error loading VRM: " + err.message);
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

document.getElementById('fbx-upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file || !currentVRM) {
    alert("Please load a VRM file first.");
    return;
  }
  const url = URL.createObjectURL(file);
  loadFbxFromUrl(url, () => URL.revokeObjectURL(url));
});

function loadFbxFromUrl(url, onComplete) {
  if (!currentVRM) {
    alert("Please load a VRM file first.");
    return;
  }
  document.getElementById('loading').classList.remove('hidden');

  const loader = new FBXLoader();
  loader.load(url, (fbx) => {
    // 最初の有効なアニメーションを探す（通常 .animations[0] が mixamo.com ）
    const clip = THREE.AnimationClip.findByName(fbx.animations, 'mixamo.com') || fbx.animations[0];
    if (clip) {
      const tracks = [];
      const restRotationInverse = new THREE.Quaternion();
      const parentRestWorldRotation = new THREE.Quaternion();
      const _quatA = new THREE.Quaternion();

      // hipsの高さから全体スケールを計算して歩幅調整
      const mixamoHips = fbx.getObjectByName('mixamorigHips');
      const motionHipsHeight = mixamoHips ? mixamoHips.position.y : 1;
      const vrmHipsHeight = currentVRM.humanoid.normalizedRestPose.hips ? currentVRM.humanoid.normalizedRestPose.hips.position[1] : 1;
      const hipsPositionScale = vrmHipsHeight / motionHipsHeight;

      clip.tracks.forEach((track) => {
        const trackSplits = track.name.split('.');
        const mixamoRigName = trackSplits[0];
        const propertyName = trackSplits[1];
        const vrmBoneName = mixamoVRMRigMap[mixamoRigName];
        const mixamoRigNode = fbx.getObjectByName(mixamoRigName);
        
        if (vrmBoneName && mixamoRigNode) {
          const vrmNodeName = currentVRM.humanoid.getNormalizedBoneNode(vrmBoneName)?.name;
          if (vrmNodeName) {
            
            // Mixamo骨の初期レストポーズ（ワールド回転）を保存
            mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
            mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation);

            if (track instanceof THREE.QuaternionKeyframeTrack) {
              // クォータニオンの変換
              for (let i = 0; i < track.values.length; i += 4) {
                const flatQuaternion = track.values.slice(i, i + 4);
                _quatA.fromArray(flatQuaternion);
                
                // 親のレスト時ワールド回転 * トラックの回転 * 自己レスト時ワールド回転の逆
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
                  // VRM 0.x向けに XとZを反転
                  track.values.map((v, i) => (i % 2 === 0 ? -v : v))
                )
              );
            } else if (track instanceof THREE.VectorKeyframeTrack && propertyName === 'position') {
              // 位置の変換（Hips用）VRM 0.x向けに XとZを反転
              const isInPlace = document.getElementById('anim-inplace').checked;
              const value = track.values.map((v, i) => {
                const axis = i % 3;
                if (isInPlace && (axis === 0 || axis === 2)) {
                  return 0; // XとZの移動を無効化
                }
                return (axis !== 1 ? -v : v) * hipsPositionScale;
              });
              tracks.push(new THREE.VectorKeyframeTrack(`${vrmNodeName}.${propertyName}`, track.times, value));
            }
          }
        }
      });

      const retargetedClip = new THREE.AnimationClip('vrmAnimation', clip.duration, tracks);
      
      if (currentMixer) {
        currentMixer.stopAllAction();
      }
      currentMixer = new THREE.AnimationMixer(currentVRM.scene);
      
      // ループ時にSpringBoneをリセットして「跳ねる」現象を防止
      currentMixer.addEventListener('loop', () => {
        if (currentVRM && currentVRM.springBoneManager) {
          currentVRM.springBoneManager.reset();
        }
      });

      const action = currentMixer.clipAction(retargetedClip);
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
const presetAnimations = import.meta.glob('../animation/*.fbx', { query: '?url', import: 'default', eager: true });
const animSelect = document.getElementById('preset-anim-select');

// Build UI options
Object.keys(presetAnimations).forEach(path => {
  const filename = path.split('/').pop().replace('.fbx', '');
  const option = document.createElement('option');
  option.value = presetAnimations[path];
  option.textContent = filename;
  animSelect.appendChild(option);
});

// Dropdown change listener
animSelect.addEventListener('change', (e) => {
  const url = e.target.value;
  if (!url) return;
  
  // reset file input
  document.getElementById('fbx-upload').value = '';
  
  loadFbxFromUrl(url, () => {
    // Keep selection
  });
});
