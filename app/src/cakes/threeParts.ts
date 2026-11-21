// threeParts.ts — the ONLY file that imports three.js (threeLoading.spec.ts), and only Cake3D.tsx loads it, with import().
//
// It names the few classes and constants the cake's scene uses (and the orbit controls), so the bundler keeps those and leaves the rest of
// the library (loaders, physics-like helpers, node materials, WebGPU) out of the on-demand chunk. A new thing the scene needs from three
// is added HERE, or `lib.Thing` is simply undefined at run time.
export {
  ACESFilmicToneMapping, CircleGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh,
  MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Raycaster, SRGBColorSpace, Scene, SphereGeometry, Spherical,
  TOUCH, Vector2, Vector3, WebGLRenderer,
} from 'three';
export { OrbitControls } from 'three/addons/controls/OrbitControls.js';
