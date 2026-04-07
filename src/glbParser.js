export class GLBEditor {
  constructor(arrayBuffer) {
    this.buffer = arrayBuffer;
    this.dataView = new DataView(arrayBuffer);
    this.parse();
  }

  parse() {
    const magic = this.dataView.getUint32(0, true);
    // 0x46546C67 is 'glTF' in little-endian
    if (magic !== 0x46546c67) {
      throw new Error("Invalid GLB format");
    }

    const version = this.dataView.getUint32(4, true);
    if (version !== 2) {
      throw new Error("Only GLB version 2 is supported");
    }

    this.jsonChunkLength = this.dataView.getUint32(12, true);
    const jsonChunkType = this.dataView.getUint32(16, true);
    // 0x4E4F534A is 'JSON'
    if (jsonChunkType !== 0x4e4f534a) {
      throw new Error("First chunk is not JSON");
    }

    const jsonChunkOffset = 20;
    const jsonBytes = new Uint8Array(this.buffer, jsonChunkOffset, this.jsonChunkLength);
    const jsonString = new TextDecoder("utf-8").decode(jsonBytes);
    this.json = JSON.parse(jsonString);

    const binChunkHeaderOffset = jsonChunkOffset + this.jsonChunkLength;
    if (binChunkHeaderOffset < this.buffer.byteLength) {
      this.binChunkStart = binChunkHeaderOffset;
      this.binChunkLength = this.dataView.getUint32(binChunkHeaderOffset, true);
      // We'll just slice the rest of the buffer straight for the BIN chunk
      this.binChunkData = this.buffer.slice(binChunkHeaderOffset);
    }
  }

  getBlendShapeGroups() {
    if (
      this.json.extensions &&
      this.json.extensions.VRM &&
      this.json.extensions.VRM.blendShapeMaster &&
      this.json.extensions.VRM.blendShapeMaster.blendShapeGroups
    ) {
      return this.json.extensions.VRM.blendShapeMaster.blendShapeGroups;
    }
    return [];
  }

  setBlendShapeGroups(groups) {
    if (!this.json.extensions) this.json.extensions = {};
    if (!this.json.extensions.VRM) this.json.extensions.VRM = {};
    if (!this.json.extensions.VRM.blendShapeMaster) this.json.extensions.VRM.blendShapeMaster = {};
    this.json.extensions.VRM.blendShapeMaster.blendShapeGroups = groups;
  }

  getMeshesWithMorphTargets() {
    const meshes = [];
    if (this.json.meshes) {
      this.json.meshes.forEach((mesh, index) => {
        // VRM 0.x typically stores target names in primitives[0].extras.targetNames
        if (mesh.primitives && mesh.primitives.length > 0) {
          const prim = mesh.primitives[0];
          if (prim.targets) {
            const targetNames = (prim.extras && prim.extras.targetNames) ? prim.extras.targetNames : prim.targets.map((_, i) => `Target ${i}`);
            meshes.push({
              index: index,
              name: mesh.name || `Mesh_${index}`,
              targetNames: targetNames
            });
          }
        }
      });
    }
    return meshes;
  }

  build() {
    // Stringify and encode JSON
    const jsonString = JSON.stringify(this.json);
    let jsonBytes = new TextEncoder().encode(jsonString);

    // Calculate padding for JSON
    const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
    const paddedJsonLength = jsonBytes.length + jsonPadding;

    // Create new buffer for JSON chunk with padding (spaces)
    const paddedJsonBytes = new Uint8Array(paddedJsonLength);
    paddedJsonBytes.set(jsonBytes);
    for (let i = 0; i < jsonPadding; i++) {
      paddedJsonBytes[jsonBytes.length + i] = 0x20; // Space character
    }

    // Total length = 12 (header) + 8 (json header) + paddedJsonLength + binChunkData.byteLength
    const binChunkSize = this.binChunkData ? this.binChunkData.byteLength : 0;
    const totalLength = 12 + 8 + paddedJsonLength + binChunkSize;

    const outBuffer = new ArrayBuffer(totalLength);
    const outView = new DataView(outBuffer);
    const outBytes = new Uint8Array(outBuffer);

    // Header
    outView.setUint32(0, 0x46546c67, true); // 'glTF'
    outView.setUint32(4, 2, true); // version 2
    outView.setUint32(8, totalLength, true); // total length

    // JSON Chunk Header
    outView.setUint32(12, paddedJsonLength, true); // chunk length
    outView.setUint32(16, 0x4e4f534a, true); // 'JSON'

    // JSON Chunk Data
    outBytes.set(paddedJsonBytes, 20);

    // BIN Chunk Data
    if (this.binChunkData) {
      const binOffset = 20 + paddedJsonLength;
      outBytes.set(new Uint8Array(this.binChunkData), binOffset);
    }

    return outBuffer;
  }
}
