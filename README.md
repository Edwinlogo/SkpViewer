# SkpXR — Visor WebXR Offline (PWA) para SketchUp

Visor 3D y **WebXR (AR Passthrough / VR)** progresivo e instalable (PWA) para archivos creados en **SketchUp**, con funcionamiento **100% sin conexión a internet**.

## Funcionalidades principales

- **Lectura nativa de `.skp` en el navegador (sin servidor):** Compatible con archivos SketchUp modernos (2021+, contenedor VFF) y clásicos (2013–2020, formato MFC) mediante `openskp`, además de formatos exportados desde SketchUp: `.glb`, `.gltf`, `.dae` (Collada), `.kmz` (Collada con texturas) y `.obj`.
- **Quitar fondo / Modo Passthrough:**
  - En **WebXR AR (`immersive-ar`)**: passthrough real del visor (Meta Quest 3/Pro, Android XR, Chrome Android ARCore) con detección de superficies (*hit-test*) y sombra proyectada sobre el suelo real.
  - Alternancia instantánea entre **Passthrough (sin fondo)**, **Estudio**, **Oscuro CAD** y **Cámara en vivo** (respaldo con cámara trasera en dispositivos sin WebXR AR).
- **Rotar, mover y escalar el modelo:**
  - En escritorio/táctil: Gizmo 3D interactivo (`Órbita`, `Mover`, `Rotar`, `Escalar`), sliders y campos numéricos precisos, escalas arquitectónicas (`1:1`, `1:10`, `1:20`, `1:50`, `1:100`, `Ajustar`) y apoyo automático al suelo.
  - En **WebXR**: agarre directo con 1 mano (mover y rotar), agarre con 2 manos o *hand tracking pinch* (escalar, girar y mover), joysticks de mandos VR/MR y un **Panel Espacial 3D flotante** raycastable dentro del visor.
- **Gestión de Capas (Etiquetas) y Elementos (Esquema):**
  - Panel de **Capas** con búsqueda, color de capa, mostrar/ocultar individual, aislar capa y mostrar/ocultar todas.
  - Árbol jerárquico de **Elementos** (grupos, componentes y mallas) con selección 3D, enfoque de cámara, ocultar/mostrar, aislar e inspector de atributos SketchUp / BIM.
  - Modos de inspección visual: **Aristas CAD** y **Rayos X**.
- **Reproducción de Escenas de Animación:**
  - Lee las **Escenas (`Pages`)** guardadas en archivos `.skp` (posición de cámara, objetivo, FOV y capas ocultas por escena) y reproduce transiciones suaves tipo recorrido.
  - Reproduce también clips de animación embebidos en `.glb`/`.gltf`/`.dae` con línea de tiempo y velocidad ajustable (`0.5×` a `2×`).
  - Permite **capturar nuevas escenas personalizadas** (cámara + visibilidad actual de capas/elementos) y guardarlas offline.
- **PWA Instalable y 100% Offline:**
  - Service Worker (Workbox) que precachea toda la aplicación y el modelo demo `.skp`.
  - Biblioteca local en **IndexedDB** para guardar y reabrir tus modelos sin conexión.
  - Soporte de **File Handling API** para abrir archivos `.skp` directamente con la app instalada.

## Ejecución local

```bash
npm install
npm run dev
```

Para construir la PWA lista para producción y probarla localmente:

```bash
npm run build
npm run preview
```

> **Nota sobre WebXR y cámara:** Los navegadores requieren **HTTPS** (o `localhost`) para habilitar WebXR (`immersive-ar` / `immersive-vr`), cámara passthrough y Service Workers.

## Atajos de teclado

- `Q` — Modo Órbita
- `G` — Gizmo Mover
- `R` — Gizmo Rotar
- `S` — Gizmo Escalar
- `B` — Quitar/Mostrar fondo (Passthrough)
- `E` — Mostrar/Ocultar aristas CAD
- `X` — Modo Rayos X
- `F` — Encuadrar modelo
- `Espacio` — Reproducir / Pausar escenas
