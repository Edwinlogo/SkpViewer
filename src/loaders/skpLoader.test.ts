import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { create } from 'openskp';
import { zipSync } from 'fflate';
import { loadSkpFromBuffer } from './skpLoader';
import { extractSkpSceneHiddenEntities } from './skpSceneEntities';
import { detectModelFormat, loadModelFromBuffer } from './universalLoader';

describe('SketchUp (.skp) & Universal Loader', () => {
  it('detects supported SketchUp and 3D formats', () => {
    expect(detectModelFormat('casa.skp')).toBe('skp');
    expect(detectModelFormat('MODELO.SKP')).toBe('skp');
    expect(detectModelFormat('export.glb')).toBe('glb');
    expect(detectModelFormat('scene.gltf')).toBe('gltf');
    expect(detectModelFormat('edificio.dae')).toBe('dae');
    expect(detectModelFormat('proyecto.kmz')).toBe('kmz');
    expect(detectModelFormat('mesh.obj')).toBe('obj');
    expect(detectModelFormat('notes.pdf')).toBeNull();
  });

  it('parses the bundled architectural demo .skp with layers, hierarchy and demo scenes', async () => {
    const skpPath = path.resolve('public/samples/pabellon-demo.skp');
    const raw = fs.readFileSync(skpPath);
    const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);

    const model = await loadModelFromBuffer({
      buffer,
      fileName: 'Pabellon_Arquitectonico.skp',
      modelId: 'demo-test',
      isDemo: true,
    });

    expect(model.format).toBe('skp');
    expect(model.stats.meshes).toBeGreaterThan(15);
    expect(model.stats.triangles).toBeGreaterThan(200);
    expect(model.layers.length).toBeGreaterThanOrEqual(7);

    const layerNames = model.layers.map((l) => l.id);
    expect(layerNames).toContain('Estructura');
    expect(layerNames).toContain('Muros');
    expect(layerNames).toContain('Cubierta');
    expect(layerNames).toContain('Acristalamiento');
    expect(layerNames).toContain('Mobiliario');
    expect(layerNames).toContain('Vegetacion');

    // Architectural bounds ~12.4m x 4m x 10.4m
    expect(model.rawSize[0]).toBeGreaterThan(10);
    expect(model.rawSize[1]).toBeGreaterThan(3.5);
    expect(model.rawSize[2]).toBeGreaterThan(9);

    // Demo scenes with both layer visibility overrides and per-element hidden overrides
    expect(model.scenes.length).toBe(5);
    expect(model.scenes.some((s) => (s.hiddenLayerIds?.length ?? 0) > 0)).toBe(true);
    const scene5 = model.scenes[4];
    expect(scene5.hiddenLayerIds).toEqual([]);
    expect((scene5.hiddenNodeIds?.length ?? 0)).toBeGreaterThanOrEqual(4);
    expect(model.nodeMap.size).toBeGreaterThan(10);
  });

  it('preserves hidden layers and hidden instances from native .skp files', async () => {
    const builder = create();
    const matBlue = builder.addMaterial('Azul', [40, 140, 240, 255]);
    const layerHidden = builder.addLayer('CapaOculta', { color: [255, 80, 80], hidden: true });
    const layerVisible = builder.addLayer('CapaVisible', { color: [80, 220, 120] });

    const block = builder.addComponentDefinition('Bloque', (def) => {
      def.addFace(
        [
          [0, 0, 0],
          [39.37, 0, 0],
          [39.37, 39.37, 0],
          [0, 39.37, 0],
        ],
        { material: matBlue },
      );
    });

    builder.addInstance(block, { name: 'VisibleInst', layer: layerVisible, translation: [0, 0, 0] });
    builder.addInstance(block, {
      name: 'HiddenInst',
      layer: layerHidden,
      translation: [50, 0, 0],
      hidden: true,
    });

    const bytes = builder.toBytes();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const ab = copy.buffer;

    const model = await loadSkpFromBuffer(ab, 'custom.skp', 'test-custom');
    const hiddenLayerInfo = model.layers.find((l) => l.id === 'CapaOculta');
    const visibleLayerInfo = model.layers.find((l) => l.id === 'CapaVisible');

    expect(hiddenLayerInfo).toBeDefined();
    expect(hiddenLayerInfo?.visible).toBe(false);
    expect(visibleLayerInfo?.visible).toBe(true);

    const hiddenNode = model.tree.children.find((c) => c.name === 'HiddenInst');
    expect(hiddenNode).toBeDefined();
    expect(hiddenNode?.visible).toBe(false);
  });

  it('extracts per-scene hidden elements (tag 29007) from VFF .skp files', () => {
    const tlv = (tag: number, payload: Uint8Array): Uint8Array => {
      const out = new Uint8Array(6 + payload.length);
      out[0] = tag & 0xff;
      out[1] = (tag >> 8) & 0xff;
      const dv = new DataView(out.buffer);
      dv.setUint32(2, payload.length, true);
      out.set(payload, 6);
      return out;
    };
    const concat = (...parts: Uint8Array[]): Uint8Array => {
      const total = parts.reduce((acc, p) => acc + p.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const p of parts) {
        out.set(p, off);
        off += p.length;
      }
      return out;
    };

    // Instance (6419) with entityId = 42 and 16-byte GUID 0102...10
    const guidBytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) guidBytes[i] = i + 1;
    const guidHex = Array.from(guidBytes)
      .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
      .join('');

    const de05 = tlv(0x05de, new Uint8Array([42]));
    const dc05 = tlv(0x05dc, de05);
    const d007 = tlv(0x07d0, dc05);
    const guidNode = tlv(0x1968, guidBytes);
    const instNode = tlv(0x1964, concat(d007, guidNode));

    // Page (29000) with name "EscenaSinElemento" and tag 29007 hiding entityId 42
    const pageName = tlv(28501, new TextEncoder().encode('EscenaSinElemento'));
    const pageHead = tlv(28500, pageName);
    const hidden29007 = tlv(29007, new Uint8Array([1, 42])); // length=1, val=42
    const page29000 = tlv(29000, concat(pageHead, hidden29007));
    const wrap28001 = tlv(28001, page29000);
    const wrap28000 = tlv(28000, wrap28001);
    const pagesRoot = tlv(0x0207, wrap28000);

    const modelDat = concat(instNode, pagesRoot);
    const zipped = zipSync({ 'model.dat': modelDat });
    const ab = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;

    const result = extractSkpSceneHiddenEntities(ab, {
      guidToNodeIds: new Map([[guidHex, ['node-7']]]),
      nameToNodeIds: new Map(),
    });

    expect(result.detected).toBe(true);
    expect(result.byPageIndex.get(0)).toEqual(['node-7']);
    expect(result.byPageName.get('EscenaSinElemento')).toEqual(['node-7']);
  });
});
