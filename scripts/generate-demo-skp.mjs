// Generates a real, standards-compliant SketchUp (.skp) architectural pavilion demo model
// with multiple Layers/Tags, nested Component Definitions, Groups, cutout windows, glass,
// furniture, and landscaping so users can immediately test native .skp parsing offline!
import fs from 'node:fs';
import path from 'node:path';
import { create, parseSkp, buildInstancedScene } from 'openskp';

const M = 39.37007874; // 1 meter in SketchUp inches (Z-up)

/** Helper to add a 6-face rectangular solid (box) in SketchUp coordinates (inches, Z-up). */
function addBox(target, x0, y0, z0, x1, y1, z1, opts = {}) {
  // Bottom (normal -Z)
  target.addFace(
    [
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y0, z0],
    ],
    opts,
  );
  // Top (normal +Z)
  target.addFace(
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    opts,
  );
  // Front (-Y)
  target.addFace(
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ],
    opts,
  );
  // Back (+Y)
  target.addFace(
    [
      [x1, y1, z0],
      [x0, y1, z0],
      [x0, y1, z1],
      [x1, y1, z1],
    ],
    opts,
  );
  // Left (-X)
  target.addFace(
    [
      [x0, y1, z0],
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
    ],
    opts,
  );
  // Right (+X)
  target.addFace(
    [
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x1, y0, z1],
    ],
    opts,
  );
}

/** Helper to build a vertical wall with rectangular openings (windows/doors) along Y = const. */
function addWallWithHolesY(target, x0, x1, y0, y1, z0, z1, holesXZ = [], opts = {}) {
  const outerFront = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y0, z1],
    [x0, y0, z1],
  ];
  const outerBack = [
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y1, z1],
    [x1, y1, z1],
  ];
  const frontHoles = holesXZ.map(([hx0, hz0, hx1, hz1]) => [
    [hx0, y0, hz0],
    [hx0, y0, hz1],
    [hx1, y0, hz1],
    [hx1, y0, hz0],
  ]);
  const backHoles = holesXZ.map(([hx0, hz0, hx1, hz1]) => [
    [hx1, y1, hz0],
    [hx1, y1, hz1],
    [hx0, y1, hz1],
    [hx0, y1, hz0],
  ]);
  target.addFace(outerFront, { ...opts, holes: frontHoles });
  target.addFace(outerBack, { ...opts, holes: backHoles });
  // Top, Bottom, Left, Right caps
  target.addFace(
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    opts,
  );
  target.addFace(
    [
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y0, z0],
    ],
    opts,
  );
  target.addFace(
    [
      [x0, y1, z0],
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
    ],
    opts,
  );
  target.addFace(
    [
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x1, y0, z1],
    ],
    opts,
  );
  // Opening reveals (jambs, sill, lintel)
  for (const [hx0, hz0, hx1, hz1] of holesXZ) {
    // Sill
    target.addFace(
      [
        [hx0, y0, hz0],
        [hx1, y0, hz0],
        [hx1, y1, hz0],
        [hx0, y1, hz0],
      ],
      opts,
    );
    // Lintel
    target.addFace(
      [
        [hx0, y0, hz1],
        [hx0, y1, hz1],
        [hx1, y1, hz1],
        [hx1, y0, hz1],
      ],
      opts,
    );
    // Left jamb
    target.addFace(
      [
        [hx0, y0, hz0],
        [hx0, y1, hz0],
        [hx0, y1, hz1],
        [hx0, y0, hz1],
      ],
      opts,
    );
    // Right jamb
    target.addFace(
      [
        [hx1, y1, hz0],
        [hx1, y0, hz0],
        [hx1, y0, hz1],
        [hx1, y1, hz1],
      ],
      opts,
    );
  }
}

const builder = create();

// 1. Register Materials (must come before layers/definitions/geometry)
const matStone = builder.addMaterial('Travertino_Claro', [224, 217, 204, 255]);
const matConcrete = builder.addMaterial('Hormigon_Visto', [186, 189, 194, 255]);
const matStucco = builder.addMaterial('Estuco_Blanco', [244, 243, 238, 255]);
const matCedar = builder.addMaterial('Madera_Cedro', [176, 118, 72, 255]);
const matDarkOak = builder.addMaterial('Roble_Oscuro', [102, 68, 44, 255]);
const matSteel = builder.addMaterial('Acero_Antracita', [46, 53, 64, 255]);
const matGlass = builder.addMaterial('Vidrio_Arquitectonico', [145, 208, 235, 110], 0.36);
const matWater = builder.addMaterial('Agua_Espejo', [56, 168, 202, 195], 0.76);
const matFabric = builder.addMaterial('Tapiz_Arena', [218, 203, 182, 255]);
const matAccent = builder.addMaterial('Terracota_Diseno', [204, 102, 68, 255]);
const matGrass = builder.addMaterial('Cesped_Jardin', [98, 148, 86, 255]);
const matFoliage = builder.addMaterial('Follaje_Olivo', [74, 122, 68, 255]);
const matMarble = builder.addMaterial('Marmol_Isla', [236, 236, 239, 255]);

// 2. Register SketchUp Layers / Tags
const layerTerreno = builder.addLayer('Terreno y Base', { color: [168, 162, 148] });
const layerEstructura = builder.addLayer('Estructura', { color: [71, 85, 105] });
const layerMuros = builder.addLayer('Muros', { color: [226, 232, 240] });
const layerCubierta = builder.addLayer('Cubierta', { color: [180, 118, 72] });
const layerVidrios = builder.addLayer('Acristalamiento', { color: [56, 189, 248] });
const layerMobiliario = builder.addLayer('Mobiliario', { color: [234, 138, 84] });
const layerVegetacion = builder.addLayer('Vegetacion', { color: [74, 168, 92] });

// 3. Component Definitions (reusable components — instanced!)
const defColumn = builder.addComponentDefinition(
  'Columna_Acero_H',
  (def) => {
    addBox(def, -0.09 * M, -0.09 * M, 0, 0.09 * M, 0.09 * M, 3.15 * M, {
      material: matSteel,
    });
    // Base plate
    addBox(def, -0.15 * M, -0.15 * M, 0, 0.15 * M, 0.15 * M, 0.04 * M, {
      material: matSteel,
    });
  },
  { attributes: { Material: 'Acero estructural S355', Perfil: 'HEB 180', Altura: '3.15 m' } },
);

const defChair = builder.addComponentDefinition(
  'Silla_Diseno',
  (def) => {
    // 4 legs
    const legR = 0.022 * M;
    for (const [lx, ly] of [
      [-0.2, -0.2],
      [0.2, -0.2],
      [-0.2, 0.2],
      [0.2, 0.2],
    ]) {
      addBox(def, lx * M - legR, ly * M - legR, 0, lx * M + legR, ly * M + legR, 0.44 * M, {
        material: matDarkOak,
      });
    }
    // Seat cushion
    addBox(def, -0.23 * M, -0.23 * M, 0.44 * M, 0.23 * M, 0.23 * M, 0.5 * M, {
      material: matFabric,
    });
    // Backrest
    addBox(def, -0.23 * M, 0.18 * M, 0.5 * M, 0.23 * M, 0.23 * M, 0.84 * M, {
      material: matCedar,
    });
  },
  { attributes: { Tipo: 'Mobiliario Comedor', Material: 'Roble y Lino' } },
);

const defLounger = builder.addComponentDefinition(
  'Sillon_Terraza',
  (def) => {
    // Base frame
    addBox(def, -0.42 * M, -0.42 * M, 0.08 * M, 0.42 * M, 0.42 * M, 0.22 * M, {
      material: matCedar,
    });
    // Seat cushion
    addBox(def, -0.39 * M, -0.39 * M, 0.22 * M, 0.39 * M, 0.39 * M, 0.4 * M, {
      material: matFabric,
    });
    // Back cushion
    addBox(def, -0.39 * M, 0.22 * M, 0.4 * M, 0.39 * M, 0.39 * M, 0.78 * M, {
      material: matAccent,
    });
    // Legs
    for (const [lx, ly] of [
      [-0.36, -0.36],
      [0.36, -0.36],
      [-0.36, 0.36],
      [0.36, 0.36],
    ]) {
      addBox(def, (lx - 0.03) * M, (ly - 0.03) * M, 0, (lx + 0.03) * M, (ly + 0.03) * M, 0.08 * M, {
        material: matSteel,
      });
    }
  },
  { attributes: { Tipo: 'Lounge Exterior', Acabado: 'Cedro + Terracota' } },
);

const defTree = builder.addComponentDefinition(
  'Arbol_Arquitectonico',
  (def) => {
    // Planter box
    addBox(def, -0.42 * M, -0.42 * M, 0, 0.42 * M, 0.42 * M, 0.48 * M, {
      material: matConcrete,
    });
    // Trunk
    addBox(def, -0.07 * M, -0.07 * M, 0.48 * M, 0.07 * M, 0.07 * M, 1.55 * M, {
      material: matDarkOak,
    });
    // Layered minimalist canopy
    addBox(def, -0.62 * M, -0.62 * M, 1.48 * M, 0.62 * M, 0.62 * M, 2.25 * M, {
      material: matFoliage,
    });
    addBox(def, -0.44 * M, -0.44 * M, 2.25 * M, 0.44 * M, 0.44 * M, 2.75 * M, {
      material: matGrass,
    });
  },
  { attributes: { Especie: 'Olivo ornamental' } },
);

const defPergolaBeam = builder.addComponentDefinition('Viga_Pergola', (def) => {
  addBox(def, -0.045 * M, -1.65 * M, 0, 0.045 * M, 1.65 * M, 0.14 * M, {
    material: matCedar,
  });
});

// 4. Architectural Groups
// Base Plinth + Pool + Garden Strip
builder.addGroup(
  (g) => {
    // Lawn ground apron
    addBox(g, -6.2 * M, -5.2 * M, 0, 6.2 * M, 5.2 * M, 0.08 * M, { material: matGrass });
    // Main travertine podium
    addBox(g, -5.2 * M, -4.0 * M, 0.08 * M, 5.2 * M, 4.0 * M, 0.34 * M, { material: matStone });
    // Entrance steps
    addBox(g, -2.0 * M, -4.55 * M, 0.08 * M, 2.0 * M, -4.0 * M, 0.22 * M, { material: matStone });
    // Timber terrace deck on right front
    addBox(g, 0.6 * M, -3.8 * M, 0.34 * M, 5.0 * M, -0.6 * M, 0.4 * M, { material: matCedar });
    // Reflective water pool on front-left
    addBox(g, -4.9 * M, -3.7 * M, 0.34 * M, -1.5 * M, -1.2 * M, 0.43 * M, { material: matConcrete });
    addBox(g, -4.72 * M, -3.52 * M, 0.43 * M, -1.68 * M, -1.38 * M, 0.48 * M, { material: matWater });
  },
  { name: 'Plataforma_y_Espejo_Agua', layer: layerTerreno },
);

// Structural Frame (Beams)
builder.addGroup(
  (g) => {
    // Perimeter roof steel fascia beams
    addBox(g, -4.8 * M, -1.0 * M, 3.45 * M, 4.8 * M, -0.82 * M, 3.66 * M, { material: matSteel });
    addBox(g, -4.8 * M, 3.42 * M, 3.45 * M, 4.8 * M, 3.6 * M, 3.66 * M, { material: matSteel });
    addBox(g, -4.8 * M, -0.82 * M, 3.45 * M, -4.62 * M, 3.42 * M, 3.66 * M, { material: matSteel });
    addBox(g, 4.62 * M, -0.82 * M, 3.45 * M, 4.8 * M, 3.42 * M, 3.66 * M, { material: matSteel });
    // Pergola front steel header over terrace
    addBox(g, 0.7 * M, -3.6 * M, 3.15 * M, 4.75 * M, -3.44 * M, 3.32 * M, { material: matSteel });
  },
  { name: 'Vigas_Principales', layer: layerEstructura },
);

// Walls (with real architectural window cutouts using holes!)
builder.addGroup(
  (g) => {
    // Rear main wall with panoramic window cutout
    addWallWithHolesY(
      g,
      -4.6 * M,
      4.6 * M,
      3.15 * M,
      3.42 * M,
      0.34 * M,
      3.45 * M,
      [
        [-3.2 * M, 1.15 * M, -0.8 * M, 2.85 * M],
        [1.0 * M, 1.15 * M, 3.4 * M, 2.85 * M],
      ],
      { material: matStucco },
    );
    // West solid concrete core wall
    addBox(g, -4.6 * M, -0.82 * M, 0.34 * M, -4.32 * M, 3.15 * M, 3.45 * M, {
      material: matConcrete,
    });
    // Interior partition feature wall (terracotta accent)
    addBox(g, -0.95 * M, 0.9 * M, 0.34 * M, -0.72 * M, 3.15 * M, 3.45 * M, {
      material: matAccent,
    });
    // Low sculptural garden wall on East
    addBox(g, 4.42 * M, 0.8 * M, 0.34 * M, 4.65 * M, 3.15 * M, 1.95 * M, {
      material: matStucco,
    });
  },
  { name: 'Muros_Arquitectonicos', layer: layerMuros },
);

// Roof Slab with Skylight Cutout
builder.addGroup(
  (g) => {
    const z0 = 3.5 * M;
    const z1 = 3.84 * M;
    // Roof around central skylight opening (-1.6..1.6 x 0.4..2.4)
    const outerTop = [
      [-5.3 * M, -1.6 * M, z1],
      [5.3 * M, -1.6 * M, z1],
      [5.3 * M, 4.1 * M, z1],
      [-5.3 * M, 4.1 * M, z1],
    ];
    const outerBottom = [
      [-5.3 * M, -1.6 * M, z0],
      [-5.3 * M, 4.1 * M, z0],
      [5.3 * M, 4.1 * M, z0],
      [5.3 * M, -1.6 * M, z0],
    ];
    const holeTop = [
      [-1.5 * M, 0.55 * M, z1],
      [-1.5 * M, 2.35 * M, z1],
      [1.5 * M, 2.35 * M, z1],
      [1.5 * M, 0.55 * M, z1],
    ];
    const holeBottom = [
      [-1.5 * M, 0.55 * M, z0],
      [1.5 * M, 0.55 * M, z0],
      [1.5 * M, 2.35 * M, z0],
      [-1.5 * M, 2.35 * M, z0],
    ];
    g.addFace(outerTop, { material: matConcrete, holes: [holeTop] });
    g.addFace(outerBottom, { material: matCedar, holes: [holeBottom] });
    // Roof edges
    addBox(g, -5.3 * M, -1.6 * M, z0, 5.3 * M, -1.52 * M, z1, { material: matSteel });
    addBox(g, -5.3 * M, 4.02 * M, z0, 5.3 * M, 4.1 * M, z1, { material: matSteel });
    addBox(g, -5.3 * M, -1.52 * M, z0, -5.22 * M, 4.02 * M, z1, { material: matSteel });
    addBox(g, 5.22 * M, -1.52 * M, z0, 5.3 * M, 4.02 * M, z1, { material: matSteel });
    // Skylight parapet curb
    addBox(g, -1.58 * M, 0.47 * M, z1, 1.58 * M, 0.55 * M, z1 + 0.16 * M, { material: matSteel });
    addBox(g, -1.58 * M, 2.35 * M, z1, 1.58 * M, 2.43 * M, z1 + 0.16 * M, { material: matSteel });
    addBox(g, -1.58 * M, 0.55 * M, z1, -1.5 * M, 2.35 * M, z1 + 0.16 * M, { material: matSteel });
    addBox(g, 1.5 * M, 0.55 * M, z1, 1.58 * M, 2.35 * M, z1 + 0.16 * M, { material: matSteel });
  },
  { name: 'Cubierta_en_Voladizo', layer: layerCubierta },
);

// Architectural Glazing (Curtain Wall, Rear Windows, Skylight Glass)
builder.addGroup(
  (g) => {
    // Front panoramic curtain wall (left & right glass leaves with central open entry)
    addBox(g, -4.3 * M, -0.84 * M, 0.36 * M, -1.1 * M, -0.79 * M, 3.45 * M, { material: matGlass });
    addBox(g, 1.1 * M, -0.84 * M, 0.36 * M, 4.55 * M, -0.79 * M, 3.45 * M, { material: matGlass });
    // Mullions
    for (const mx of [-2.7, -1.12, 1.12, 2.85]) {
      addBox(g, (mx - 0.03) * M, -0.88 * M, 0.34 * M, (mx + 0.03) * M, -0.76 * M, 3.45 * M, {
        material: matSteel,
      });
    }
    // East glass corner panel
    addBox(g, 4.52 * M, -0.79 * M, 0.36 * M, 4.58 * M, 0.8 * M, 3.45 * M, { material: matGlass });
    // Rear window glazing
    addBox(g, -3.2 * M, 3.26 * M, 1.15 * M, -0.8 * M, 3.31 * M, 2.85 * M, { material: matGlass });
    addBox(g, 1.0 * M, 3.26 * M, 1.15 * M, 3.4 * M, 3.31 * M, 2.85 * M, { material: matGlass });
    // Skylight glass pane
    addBox(g, -1.5 * M, 0.55 * M, 3.92 * M, 1.5 * M, 2.35 * M, 3.98 * M, { material: matGlass });
  },
  { name: 'Fachada_Acristalada', layer: layerVidrios },
);

// Dining Table & Kitchen Island Group
builder.addGroup(
  (g) => {
    // Dining table
    addBox(g, 0.65 * M, 0.45 * M, 0.72 * M, 2.75 * M, 1.45 * M, 0.79 * M, { material: matCedar });
    addBox(g, 0.88 * M, 0.62 * M, 0.34 * M, 0.96 * M, 1.28 * M, 0.72 * M, { material: matSteel });
    addBox(g, 2.44 * M, 0.62 * M, 0.34 * M, 2.52 * M, 1.28 * M, 0.72 * M, { material: matSteel });
    // Kitchen island on left
    addBox(g, -3.65 * M, 1.3 * M, 0.34 * M, -1.55 * M, 2.25 * M, 1.22 * M, { material: matMarble });
    addBox(g, -3.55 * M, 1.38 * M, 0.34 * M, -1.65 * M, 2.18 * M, 1.15 * M, { material: matDarkOak });
    // Low coffee table on terrace
    addBox(g, 2.15 * M, -2.65 * M, 0.4 * M, 3.35 * M, -1.95 * M, 0.74 * M, { material: matStone });
  },
  { name: 'Mesas_e_Isla', layer: layerMobiliario },
);

// 5. Place Component Instances (Columns, Pergola Louvers, Chairs, Loungers, Trees)
const columnCoords = [
  [-4.65, -0.88],
  [-1.08, -0.88],
  [1.08, -0.88],
  [4.65, -0.88],
  [-4.65, 3.45],
  [4.65, 3.45],
  [0.82, -3.52],
  [4.65, -3.52],
];
columnCoords.forEach(([cx, cy], i) => {
  builder.addInstance(defColumn, {
    name: `Columna_${i + 1}`,
    translation: [cx * M, cy * M, 0.34 * M],
    layer: layerEstructura,
  });
});

// Pergola cedar louvers over terrace
for (let i = 0; i < 9; i++) {
  const lx = 1.05 + i * 0.43;
  builder.addInstance(defPergolaBeam, {
    name: `Lama_Pergola_${i + 1}`,
    translation: [lx * M, -2.18 * M, 3.32 * M],
    layer: layerCubierta,
  });
}

// Dining chairs around the table
const chairPlacements = [
  { x: 1.2, y: 0.15, rot: Math.PI },
  { x: 2.2, y: 0.15, rot: Math.PI },
  { x: 1.2, y: 1.75, rot: 0 },
  { x: 2.2, y: 1.75, rot: 0 },
];
chairPlacements.forEach((c, idx) => {
  builder.addInstance(defChair, {
    name: `Silla_Comedor_${idx + 1}`,
    translation: [c.x * M, c.y * M, 0.34 * M],
    rotation: { axis: [0, 0, 1], angleRadians: c.rot },
    layer: layerMobiliario,
  });
});

// Terrace loungers
builder.addInstance(defLounger, {
  name: 'Sillon_Terraza_1',
  translation: [2.25 * M, -3.1 * M, 0.4 * M],
  rotation: { axis: [0, 0, 1], angleRadians: Math.PI },
  layer: layerMobiliario,
});
builder.addInstance(defLounger, {
  name: 'Sillon_Terraza_2',
  translation: [3.25 * M, -3.1 * M, 0.4 * M],
  rotation: { axis: [0, 0, 1], angleRadians: Math.PI },
  layer: layerMobiliario,
});

// Architectural trees
const treeSpots = [
  [-5.45, -3.95],
  [-5.45, 3.65],
  [5.45, -3.75],
  [5.45, 3.65],
];
treeSpots.forEach(([tx, ty], i) => {
  builder.addInstance(defTree, {
    name: `Arbol_${i + 1}`,
    translation: [tx * M, ty * M, 0.08 * M],
    layer: layerVegetacion,
  });
});

const bytes = builder.toBytes();
const outPath = path.resolve('public/samples/pabellon-demo.skp');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, bytes);

// Self-verify round-trip with openskp right now!
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const parsed = parseSkp(ab);
const instanced = buildInstancedScene(ab);
console.log(
  `Generated ${outPath} (${bytes.byteLength} bytes) — version=${parsed.version}, layers=${parsed.layers.length}, meshResources=${instanced.meshResources.length}, bounds=${JSON.stringify(instanced.bounds?.size.map((v) => Number(v.toFixed(2))))}`,
);
