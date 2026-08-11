"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export type DonutAsset = {
  id: string;
  ticker: string;
  name: string;
  category: string;
  categoryColor: string;
  weight: number;
  risk: number;
  color: string;
};

export type DonutTarget =
  | { kind: "asset"; id: string }
  | { kind: "category"; id: string };

type Props = {
  assets: DonutAsset[];
  onHover: (target: DonutTarget | null) => void;
  onSelect: (target: DonutTarget) => void;
};

type SegmentOptions = {
  id: string;
  kind: DonutTarget["kind"];
  category: string;
  start: number;
  end: number;
  innerRadius: number;
  outerRadius: number;
  depth: number;
  color: string;
};

export default function AllocationDonut3D({ assets, onHover, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onHoverRef = useRef(onHover);
  const onSelectRef = useRef(onSelect);

  useEffect(() => { onHoverRef.current = onHover; }, [onHover]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || assets.length === 0) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.08, 6.75);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute("role", "application");
    renderer.domElement.setAttribute("aria-label", "三维目标仓位图，内圈为板块，外圈为具体资产");
    host.appendChild(renderer.domElement);

    const ring = new THREE.Group();
    ring.rotation.x = -0.62;
    ring.rotation.z = -0.04;
    scene.add(ring);

    scene.add(new THREE.HemisphereLight(0xf5f1df, 0x171815, 1.25));

    const key = new THREE.DirectionalLight(0xfff0d2, 2.45);
    key.position.set(-3.8, 4.8, 6.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -4;
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x91ffe0, 1.25);
    rim.position.set(4.5, -2.2, 3.6);
    scene.add(rim);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 6.4),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.4 }),
    );
    shadow.position.z = -0.52;
    shadow.receiveShadow = true;
    scene.add(shadow);

    const meshes: THREE.Mesh[] = [];
    const total = assets.reduce((sum, asset) => sum + asset.weight, 0) || 1;

    function createSegment(options: SegmentOptions) {
      if (options.end <= options.start) return;
      const shape = new THREE.Shape();
      shape.moveTo(Math.cos(options.start) * options.innerRadius, Math.sin(options.start) * options.innerRadius);
      shape.lineTo(Math.cos(options.start) * options.outerRadius, Math.sin(options.start) * options.outerRadius);
      shape.absarc(0, 0, options.outerRadius, options.start, options.end, false);
      shape.lineTo(Math.cos(options.end) * options.innerRadius, Math.sin(options.end) * options.innerRadius);
      shape.absarc(0, 0, options.innerRadius, options.end, options.start, true);
      shape.closePath();

      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: options.depth,
        bevelEnabled: true,
        bevelSegments: 4,
        bevelSize: options.kind === "category" ? 0.028 : 0.035,
        bevelThickness: 0.04,
        curveSegments: 56,
        steps: 1,
      });
      geometry.translate(0, 0, -options.depth / 2);

      const faceColor = new THREE.Color(options.color);
      const sideColor = faceColor.clone().multiplyScalar(options.kind === "category" ? 0.48 : 0.58);
      const face = new THREE.MeshStandardMaterial({
        color: faceColor,
        emissive: faceColor.clone().multiplyScalar(0.03),
        metalness: options.kind === "category" ? 0.24 : 0.16,
        roughness: options.kind === "category" ? 0.24 : 0.3,
      });
      const side = new THREE.MeshStandardMaterial({
        color: sideColor,
        metalness: 0.1,
        roughness: 0.5,
      });
      const mesh = new THREE.Mesh(geometry, [face, side]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.target = { kind: options.kind, id: options.id } satisfies DonutTarget;
      mesh.userData.targetKey = `${options.kind}:${options.id}`;
      mesh.userData.kind = options.kind;
      mesh.userData.category = options.category;
      mesh.userData.faceMaterial = face;
      ring.add(mesh);
      meshes.push(mesh);
    }

    let categoryCursor = -Math.PI / 2;
    const categories = [...new Set(assets.map((asset) => asset.category))];
    categories.forEach((category) => {
      const categoryAssets = assets.filter((asset) => asset.category === category);
      const weight = categoryAssets.reduce((sum, asset) => sum + asset.weight, 0);
      const sweep = Math.PI * 2 * weight / total;
      const gap = 0.036;
      createSegment({
        id: category,
        kind: "category",
        category,
        start: categoryCursor + gap / 2,
        end: categoryCursor + sweep - gap / 2,
        innerRadius: 0.98,
        outerRadius: 1.39,
        depth: 0.3,
        color: categoryAssets[0]?.categoryColor ?? "#8d9089",
      });
      categoryCursor += sweep;
    });

    let assetCursor = -Math.PI / 2;
    assets.forEach((asset) => {
      const sweep = Math.PI * 2 * asset.weight / total;
      const gap = 0.022;
      createSegment({
        id: asset.id,
        kind: "asset",
        category: asset.category,
        start: assetCursor + gap / 2,
        end: assetCursor + sweep - gap / 2,
        innerRadius: 1.49,
        outerRadius: 2.02,
        depth: 0.22,
        color: asset.color,
      });
      assetCursor += sweep;
    });

    const pointer = new THREE.Vector2(8, 8);
    const raycaster = new THREE.Raycaster();
    let hoveredTarget: DonutTarget | null = null;
    let hoveredKey: string | null = null;
    let pointerX = 0;
    let pointerY = 0;
    let frame = 0;

    function setHovered(target: DonutTarget | null) {
      const key = target ? `${target.kind}:${target.id}` : null;
      if (key === hoveredKey) return;
      hoveredTarget = target;
      hoveredKey = key;
      renderer.domElement.style.cursor = target ? "pointer" : "default";
      onHoverRef.current(target);
    }

    function updatePointer(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      pointerX = pointer.x;
      pointerY = pointer.y;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      setHovered(hit ? hit.object.userData.target as DonutTarget : null);
    }

    function clearPointer() {
      pointerX = 0;
      pointerY = 0;
      setHovered(null);
    }

    function selectHovered() {
      if (hoveredTarget) onSelectRef.current(hoveredTarget);
    }

    renderer.domElement.addEventListener("pointermove", updatePointer);
    renderer.domElement.addEventListener("pointerleave", clearPointer);
    renderer.domElement.addEventListener("click", selectHovered);

    function resize() {
      const width = Math.max(1, host!.clientWidth);
      const height = Math.max(1, host!.clientHeight);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    function render() {
      frame = window.requestAnimationFrame(render);
      ring.rotation.x += ((-0.62 + pointerY * 0.055) - ring.rotation.x) * 0.055;
      ring.rotation.y += ((pointerX * 0.075) - ring.rotation.y) * 0.055;

      meshes.forEach((mesh) => {
        const direct = mesh.userData.targetKey === hoveredKey;
        const related = hoveredTarget?.kind === "category"
          && mesh.userData.kind === "asset"
          && mesh.userData.category === hoveredTarget.id;
        const lift = direct ? 0.13 : related ? 0.045 : 0;
        mesh.position.z += (lift - mesh.position.z) * 0.13;
        const face = mesh.userData.faceMaterial as THREE.MeshStandardMaterial;
        const intensity = direct ? 0.46 : related ? 0.23 : 0.08;
        face.emissiveIntensity += (intensity - face.emissiveIntensity) * 0.12;
      });

      renderer.render(scene, camera);
    }
    render();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointermove", updatePointer);
      renderer.domElement.removeEventListener("pointerleave", clearPointer);
      renderer.domElement.removeEventListener("click", selectHovered);
      onHoverRef.current(null);
      meshes.forEach((mesh) => {
        mesh.geometry.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => material.dispose());
      });
      shadow.geometry.dispose();
      (shadow.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [assets]);

  return <div ref={hostRef} className="h-full w-full" />;
}
