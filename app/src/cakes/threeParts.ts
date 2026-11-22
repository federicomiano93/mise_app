// threeParts.ts — the ONLY file that imports three.js (threeLoading.spec.ts), and only Cake3D.tsx loads it, with import().
//
// It names the few classes and constants the cake's scene uses (and the orbit controls), so the bundler keeps those and leaves the rest of
// the library (loaders, physics-like helpers, node materials, WebGPU) out of the on-demand chunk. A new thing the scene needs from three
// is added HERE, or `lib.Thing` is simply undefined at run time.
export {
  ACESFilmicToneMapping, CanvasTexture, CapsuleGeometry, CatmullRomCurve3, CircleGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, Euler,
  Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, LatheGeometry, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial,
  PCFShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Quaternion, Raycaster, RepeatWrapping, SRGBColorSpace, Scene,
  ShadowMaterial, SphereGeometry, Spherical, TOUCH, TubeGeometry, Vector2, Vector3, WebGLRenderer,
} from 'three';
export { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// The studio the shiny parts (glaze, plate, fruit) reflect, made once per scene into a small environment map.
export { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
