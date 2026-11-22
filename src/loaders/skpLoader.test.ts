import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { create } from 'openskp';
import { loadSkpFromBuffer } from './skpLoader';
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

    // Demo scenes with layer visibility overrides
    expect(model.scenes.length).toBe(5);
    expect(model.scenes.some((s) => (s.hiddenLayerIds?.length ?? 0) > 0)).toBe(true);
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
});
