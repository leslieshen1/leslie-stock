"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export type DonutAsset = {
  id: string;
  ticker: string;
  name: string;
  weight: number;
  risk: number;
  color: string;
};

type Props = {
  assets: DonutAsset[];
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
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
    camera.position.set(0, 0.08, 6.45);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.88;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute("role", "application");
    renderer.domElement.setAttribute("aria-label", "三维目标仓位圆环，悬浮查看资产，点击编辑");
    host.appendChild(renderer.domElement);

    const ring = new THREE.Group();
    ring.rotation.x = -0.62;
    ring.rotation.z = -0.04;
    scene.add(ring);

    const ambient = new THREE.HemisphereLight(0xf5f1df, 0x171815, 1.25);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xfff0d2, 2.4);
    key.position.set(-3.8, 4.8, 6.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -4;
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x91ffe0, 1.35);
    rim.position.set(4.5, -2.2, 3.6);
    scene.add(rim);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(6.2, 6.2),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.38 }),
    );
    shadow.position.z = -0.5;
    shadow.receiveShadow = true;
    scene.add(shadow);

    const meshes: THREE.Mesh[] = [];
    const total = assets.reduce((sum, asset) => sum + asset.weight, 0) || 1;
    let cursor = -Math.PI / 2;
    const outerRadius = 1.86;
    const innerRadius = 1.03;
    const gap = 0.026;

    assets.forEach((asset) => {
      const sweep = Math.PI * 2 * asset.weight / total;
      const start = cursor + gap / 2;
      const end = cursor + sweep - gap / 2;
      cursor += sweep;
      if (end <= start) return;

      const shape = new THREE.Shape();
      shape.moveTo(Math.cos(start) * innerRadius, Math.sin(start) * innerRadius);
      shape.lineTo(Math.cos(start) * outerRadius, Math.sin(start) * outerRadius);
      shape.absarc(0, 0, outerRadius, start, end, false);
      shape.lineTo(Math.cos(end) * innerRadius, Math.sin(end) * innerRadius);
      shape.absarc(0, 0, innerRadius, end, start, true);
      shape.closePath();

      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.24,
        bevelEnabled: true,
        bevelSegments: 4,
        bevelSize: 0.035,
        bevelThickness: 0.045,
        curveSegments: 56,
        steps: 1,
      });
      geometry.translate(0, 0, -0.12);

      const faceColor = new THREE.Color(asset.color);
      const sideColor = faceColor.clone().multiplyScalar(0.58);
      const face = new THREE.MeshStandardMaterial({
        color: faceColor,
        emissive: faceColor.clone().multiplyScalar(0.03),
        metalness: 0.16,
        roughness: 0.3,
      });
      const side = new THREE.MeshStandardMaterial({
        color: sideColor,
        metalness: 0.08,
        roughness: 0.48,
      });
      const mesh = new THREE.Mesh(geometry, [face, side]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.assetId = asset.id;
      mesh.userData.faceMaterial = face;
      ring.add(mesh);
      meshes.push(mesh);
    });

    const pointer = new THREE.Vector2(8, 8);
    const raycaster = new THREE.Raycaster();
    let hoveredId: string | null = null;
    let pointerX = 0;
    let pointerY = 0;
    let frame = 0;

    function setHovered(id: string | null) {
      if (id === hoveredId) return;
      hoveredId = id;
      renderer.domElement.style.cursor = id ? "pointer" : "default";
      onHoverRef.current(id);
    }

    function updatePointer(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      pointerX = pointer.x;
      pointerY = pointer.y;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      setHovered(hit ? String(hit.object.userData.assetId) : null);
    }

    function clearPointer() {
      pointerX = 0;
      pointerY = 0;
      setHovered(null);
    }

    function selectHovered() {
      if (hoveredId) onSelectRef.current(hoveredId);
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
        const active = mesh.userData.assetId === hoveredId;
        mesh.position.z += ((active ? 0.12 : 0) - mesh.position.z) * 0.13;
        const face = mesh.userData.faceMaterial as THREE.MeshStandardMaterial;
        face.emissiveIntensity += ((active ? 0.42 : 0.08) - face.emissiveIntensity) * 0.12;
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
