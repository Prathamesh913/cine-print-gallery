import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Compass, 
  Search, 
  X, 
  Copy, 
  Sparkles, 
  Palette,
  Eye,
  Info,
  Layers
} from "lucide-react";
import * as d3 from "d3";
import { toast } from "sonner";

import { Header } from "@/components/Header";
import { Lightbox } from "@/components/Lightbox";
import { fetchNotionPosters } from "@/lib/notion";
import { type Poster } from "@/lib/posters";
import posterPalettesRaw from "@/lib/poster-palettes.json";

// Typed representation of the prebuilt palette data
const posterPalettes = posterPalettesRaw as Record<
  string, 
  { palette: string[]; primary: string; hsl: { h: number; s: number; l: number } }
>;

// Define D3 Node simulation interface
interface PosterNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  year: number;
  artist: string;
  image: string;
  style: string;
  genre: string[];
  tags: string[];
  palette: string[];
  primary: string;
  hsl: { h: number; s: number; l: number };
  clusterId: string;
  clusterColor: string;
  clusterName: string;
  radius: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

// Define D3 Link interface
interface PosterLink extends d3.SimulationLinkDatum<PosterNode> {
  source: string | PosterNode;
  target: string | PosterNode;
}

// Color clusters / Nebulae definitions
const CLUSTERS = {
  red: { id: "red", name: "Red Nebula", color: "#FF3366", angle: 0 },
  orange: { id: "orange", name: "Orange Giant", color: "#FF8833", angle: 55 },
  yellow: { id: "yellow", name: "Yellow Dwarf", color: "#FFDD33", angle: 110 },
  green: { id: "green", name: "Green Cosmos", color: "#33FF66", angle: 170 },
  blue: { id: "blue", name: "Blue Supernova", color: "#3399FF", angle: 230 },
  purple: { id: "purple", name: "Purple Pulsar", color: "#B833FF", angle: 290 },
  monochrome: { id: "monochrome", name: "Monochrome Void", color: "#F5F5F5", angle: 0 } // Placed in center
};

// Map primary color HSL values to clusters
function getClusterInfo(hsl: { h: number; s: number; l: number }) {
  const { h, s, l } = hsl;
  // Grayscale conditions
  if (s < 16 || l < 15 || l > 88) {
    return CLUSTERS.monochrome;
  }
  if (h >= 0 && h < 25 || h >= 335) return CLUSTERS.red;
  if (h >= 25 && h < 55) return CLUSTERS.orange;
  if (h >= 55 && h < 75) return CLUSTERS.yellow;
  if (h >= 75 && h < 165) return CLUSTERS.green;
  if (h >= 165 && h < 265) return CLUSTERS.blue;
  return CLUSTERS.purple; // h >= 265 && h < 335
}

// Get palette and color specs with dynamic fallback
function getPosterColorInfo(id: string, title: string) {
  if (posterPalettes[id]) {
    return posterPalettes[id];
  }
  // Fallback: stable hash from title
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  const s = 65;
  const l = 50;
  // Convert HSL to Hex for primary color
  const primaryHex = d3.hsl(h, s / 100, l / 100).formatHex();
  return {
    palette: [
      primaryHex,
      d3.hsl(h, s / 100, 0.8).formatHex(),
      d3.hsl((h + 30) % 360, s / 100, 0.4).formatHex(),
      d3.hsl((h + 180) % 360, s / 100, 0.5).formatHex(),
      "#121212"
    ],
    primary: primaryHex,
    hsl: { h, s, l }
  };
}

// Calculate color harmonies for selected poster
function calculateHarmonies(h: number, s: number, l: number) {
  const format = (hVal: number, sVal = s, lVal = l) => {
    return d3.hsl((hVal + 360) % 360, sVal / 100, lVal / 100).formatHex();
  };

  return [
    { name: "Complementary", colors: [format(h), format(h + 180)] },
    { name: "Analogous", colors: [format(h - 30), format(h), format(h + 30)] },
    { name: "Triadic", colors: [format(h), format(h + 120), format(h + 240)] },
    { name: "Monochromatic", colors: [format(h, s, Math.max(15, l - 20)), format(h, s, l), format(h, s, Math.min(85, l + 20))] }
  ];
}

export const Route = createFileRoute("/constellation")({
  loader: () => fetchNotionPosters(),
  head: () => ({
    meta: [
      { title: "Color Constellation Map — CinePrint" },
      { name: "description", content: "Explore a galaxy of movie poster colors. Posters with similar color palettes gravitate together in an interactive galaxy space map." },
    ],
  }),
  component: ConstellationMap,
});

function ConstellationMap() {
  const posters = Route.useLoaderData();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // States
  const [selectedPoster, setSelectedPoster] = useState<PosterNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showLinks, setShowLinks] = useState(true);
  const [activeLightboxPoster, setActiveLightboxPoster] = useState<Poster | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [zoomTransform, setZoomTransform] = useState(d3.zoomIdentity);

  // References for rendering and physics
  const simulationRef = useRef<d3.Simulation<PosterNode, PosterLink> | null>(null);
  const nodesRef = useRef<PosterNode[]>([]);
  const linksRef = useRef<PosterLink[]>([]);
  const imageCache = useRef<Record<string, HTMLImageElement>>({});
  const hoveredNodeRef = useRef<PosterNode | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);

  // 1. Process posters to D3 nodes & links
  const { nodes, links, clusterStats } = useMemo(() => {
    if (posters.length === 0) {
      return { nodes: [], links: [], clusterStats: {} as Record<string, number> };
    }

    const processedNodes: PosterNode[] = posters.map(p => {
      const colorInfo = getPosterColorInfo(p.id, p.title);
      const cluster = getClusterInfo(colorInfo.hsl);
      return {
        ...p,
        palette: colorInfo.palette,
        primary: colorInfo.primary,
        hsl: colorInfo.hsl,
        clusterId: cluster.id,
        clusterColor: cluster.color,
        clusterName: cluster.name,
        radius: 35 // Base collision radius for poster thumbnails
      };
    });

    const stats: Record<string, number> = {};
    Object.keys(CLUSTERS).forEach(key => stats[key] = 0);
    processedNodes.forEach(n => {
      stats[n.clusterId] = (stats[n.clusterId] || 0) + 1;
    });

    // Create links between posters in the same cluster that are closest in color space
    const processedLinks: PosterLink[] = [];
    const groupedByCluster = d3.group(processedNodes, d => d.clusterId);

    groupedByCluster.forEach((clusterNodes, clusterId) => {
      if (clusterId === "monochrome" || clusterNodes.length < 2) return;

      clusterNodes.forEach(nodeA => {
        // Find distances to all other nodes in cluster
        const distances = clusterNodes
          .filter(nodeB => nodeB.id !== nodeA.id)
          .map(nodeB => {
            // Compute shortest distance in Hue circle (angular distance)
            let dh = Math.abs(nodeA.hsl.h - nodeB.hsl.h);
            if (dh > 180) dh = 360 - dh;

            // Euclidean HSL distance (weighted Hue higher)
            const ds = (nodeA.hsl.s - nodeB.hsl.s) / 100;
            const dl = (nodeA.hsl.l - nodeB.hsl.l) / 100;
            const dist = Math.sqrt((dh / 180) * 1.5 + ds * ds + dl * dl);

            return { node: nodeB, dist };
          });

        // Sort by distance and take nearest 2
        distances.sort((a, b) => a.dist - b.dist);
        const nearest = distances.slice(0, 2);

        nearest.forEach(n => {
          // Check if link already exists in reverse direction to prevent duplicates
          const exists = processedLinks.some(l => 
            (l.source === nodeA.id && l.target === n.node.id) ||
            (l.source === n.node.id && l.target === nodeA.id)
          );
          if (!exists) {
            processedLinks.push({
              source: nodeA.id,
              target: n.node.id
            });
          }
        });
      });
    });

    return { nodes: processedNodes, links: processedLinks, clusterStats: stats };
  }, [posters]);

  // 2. Set up dimensions and resize handling
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(entries => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      // Subtract header height (~72px)
      const adjustedHeight = Math.max(400, height - 72);
      setDimensions({ width, height: adjustedHeight });
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // 3. Static stars background generation
  const stars = useMemo(() => {
    const arr = [];
    const count = 200;
    for (let i = 0; i < count; i++) {
      arr.push({
        x: (Math.random() - 0.5) * 3000,
        y: (Math.random() - 0.5) * 3000,
        size: Math.random() * 1.2 + 0.3,
        brightness: Math.random() * 0.5 + 0.5,
        speed: Math.random() * 0.002 + 0.0005,
        offset: Math.random() * Math.PI * 2
      });
    }
    return arr;
  }, []);

  // 4. Calculate cluster centers dynamically based on dimensions
  const clusterCenters = useMemo(() => {
    const centers: Record<string, { x: number; y: number }> = {};
    const radius = Math.min(dimensions.width, dimensions.height) * 0.45;

    Object.values(CLUSTERS).forEach(c => {
      if (c.id === "monochrome") {
        centers[c.id] = { x: 0, y: 0 };
      } else {
        const rad = (c.angle * Math.PI) / 180;
        centers[c.id] = {
          x: radius * Math.cos(rad),
          y: radius * Math.sin(rad)
        };
      }
    });

    return centers;
  }, [dimensions]);

  // 5. Initialize and run D3 Force simulation
  useEffect(() => {
    if (nodes.length === 0) return;

    // Clone nodes and links to prevent mutating React-frozen/memoized arrays in strict mode
    const simNodes = nodes.map(n => ({ ...n }));
    const simLinks = links.map(l => ({ ...l }));

    // Sync refs to cloned nodes and links that D3 will mutate
    nodesRef.current = simNodes;
    linksRef.current = simLinks;

    // Build D3 Simulation
    const simulation = d3.forceSimulation<PosterNode>(simNodes)
      .force("charge", d3.forceManyBody<PosterNode>().strength(-35))
      .force("collide", d3.forceCollide<PosterNode>(d => d.radius + 12).strength(0.85))
      .force("x", d3.forceX<PosterNode>(d => clusterCenters[d.clusterId]?.x || 0).strength(0.065))
      .force("y", d3.forceY<PosterNode>(d => clusterCenters[d.clusterId]?.y || 0).strength(0.065))
      .force("link", d3.forceLink<PosterNode, PosterLink>(simLinks).id(d => d.id).distance(90).strength(0.04));

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [nodes, links, clusterCenters]);

  // 6. Bind zoom behavior
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.15, 3.5])
      .on("zoom", event => {
        setZoomTransform(event.transform);
      });

    zoomBehaviorRef.current = zoom;
    d3.select(canvas).call(zoom);

    // Initial transform: fit all coordinates slightly zoomed out
    d3.select(canvas).call(zoom.transform, d3.zoomIdentity.translate(dimensions.width / 2, dimensions.height / 2).scale(0.55));
  }, [dimensions]);

  // 7. HTML5 Canvas Continuous Animation Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrameId: number;

    const render = () => {
      // 7a. Clear Canvas & Draw Background Space Gradient
      ctx.fillStyle = "#0c0c10";
      ctx.fillRect(0, 0, dimensions.width, dimensions.height);

      // Create a subtle vignette effect
      const bgGrad = ctx.createRadialGradient(
        dimensions.width / 2, dimensions.height / 2, 10,
        dimensions.width / 2, dimensions.height / 2, Math.max(dimensions.width, dimensions.height)
      );
      bgGrad.addColorStop(0, "rgba(18, 18, 25, 0)");
      bgGrad.addColorStop(1, "rgba(4, 4, 6, 0.95)");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, dimensions.width, dimensions.height);

      ctx.save();
      // Apply D3 zoom and panning matrix
      ctx.translate(zoomTransform.x, zoomTransform.y);
      ctx.scale(zoomTransform.k, zoomTransform.k);

      // 7b. Draw Nebula Glows behind stars
      Object.keys(clusterCenters).forEach(cid => {
        const center = clusterCenters[cid];
        const color = CLUSTERS[cid as keyof typeof CLUSTERS].color;
        const radGrad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, 350);
        radGrad.addColorStop(0, color + "22"); // 13% opacity hex
        radGrad.addColorStop(0.5, color + "07"); // 4% opacity hex
        radGrad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = radGrad;
        ctx.beginPath();
        ctx.arc(center.x, center.y, 350, 0, Math.PI * 2);
        ctx.fill();
      });

      // 7c. Draw Twinkling Background Stars
      const time = Date.now();
      ctx.fillStyle = "#ffffff";
      stars.forEach(star => {
        const twinkle = Math.sin(time * star.speed + star.offset) * 0.35 + 0.65;
        ctx.globalAlpha = star.brightness * twinkle;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1.0;

      // 7d. Draw Constellation Link Lines (if toggled)
      if (showLinks) {
        ctx.lineWidth = 1.0;
        linksRef.current.forEach(link => {
          const source = link.source as PosterNode;
          const target = link.target as PosterNode;

          if (source.x !== undefined && source.y !== undefined && target.x !== undefined && target.y !== undefined) {
            const isHovered = hoveredNodeRef.current?.id === source.id || hoveredNodeRef.current?.id === target.id;
            const isSelected = selectedPoster?.id === source.id || selectedPoster?.id === target.id;

            // Highlight connections for selected/hovered nodes
            if (isSelected) {
              ctx.strokeStyle = source.clusterColor;
              ctx.lineWidth = 2.0;
              ctx.globalAlpha = 0.85;
            } else if (isHovered) {
              ctx.strokeStyle = source.clusterColor;
              ctx.lineWidth = 1.5;
              ctx.globalAlpha = 0.65;
            } else {
              ctx.strokeStyle = source.clusterColor;
              ctx.lineWidth = 0.8;
              ctx.globalAlpha = 0.22;
            }

            // Draw glowing line
            ctx.beginPath();
            ctx.moveTo(source.x, source.y);
            ctx.lineTo(target.x, target.y);
            ctx.stroke();
          }
        });
        ctx.globalAlpha = 1.0;
      }

      // Helper to draw color segments for placeholder circles
      const drawPalettePie = (x: number, y: number, r: number, palette: string[]) => {
        const segments = palette.length;
        const angleStep = (Math.PI * 2) / segments;
        for (let i = 0; i < segments; i++) {
          ctx.fillStyle = palette[i];
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.arc(x, y, r, i * angleStep, (i + 1) * angleStep);
          ctx.closePath();
          ctx.fill();
        }
      };

      // 7e. Draw Nodes (Posters)
      nodesRef.current.forEach(node => {
        if (node.x === undefined || node.y === undefined) return;

        const isHovered = hoveredNodeRef.current?.id === node.id;
        const isSelected = selectedPoster?.id === node.id;
        const matchesQuery = searchQuery 
          ? [node.title, node.artist, node.style].some(s => s.toLowerCase().includes(searchQuery.toLowerCase()))
          : true;

        // Visual fade out for non-matching nodes during search
        if (searchQuery && !matchesQuery) {
          ctx.globalAlpha = 0.15;
        } else {
          ctx.globalAlpha = 1.0;
        }

        // Draw glowing color aura behind poster
        const glowRadius = isSelected ? 48 : isHovered ? 40 : 25;
        const auraGrad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowRadius);
        auraGrad.addColorStop(0, node.primary + "99"); // 60% opacity
        auraGrad.addColorStop(0.5, node.primary + "33"); // 20% opacity
        auraGrad.addColorStop(1, node.primary + "00"); // 0% opacity
        ctx.fillStyle = auraGrad;
        ctx.beginPath();
        ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        // Zoom-dependent rendering: Fades between dots and thumbnail cards
        const k = zoomTransform.k;
        if (k < 0.65) {
          // Zooms Out: Render as bright star points
          const dotRadius = isSelected ? 9 : isHovered ? 7.5 : 5.5;
          ctx.fillStyle = node.primary;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = isSelected ? 2.5 : isHovered ? 1.5 : 1;

          ctx.beginPath();
          ctx.arc(node.x, node.y, dotRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Render miniature floating names for selected or hovered dots
          if (isHovered || isSelected) {
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 12px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(node.title, node.x, node.y - dotRadius - 6);
          }
        } else {
          // Zooms In: Render as rounded cards (Aspect ratio 2:3)
          const w = 38;
          const h = 57;
          const rx = node.x - w / 2;
          const ry = node.y - h / 2;
          const radius = 4; // Card corner radius

          // Handle selection border expansion
          const expandFactor = isSelected ? 1.12 : isHovered ? 1.06 : 1.0;
          const sw = w * expandFactor;
          const sh = h * expandFactor;
          const srx = node.x - sw / 2;
          const sry = node.y - sh / 2;

          ctx.save();
          // Draw rounded clipping path for card
          ctx.beginPath();
          ctx.moveTo(srx + radius, sry);
          ctx.lineTo(srx + sw - radius, sry);
          ctx.quadraticCurveTo(srx + sw, sry, srx + sw, sry + radius);
          ctx.lineTo(srx + sw, sry + sh - radius);
          ctx.quadraticCurveTo(srx + sw, sry + sh, srx + sw - radius, sry + sh);
          ctx.lineTo(srx + radius, sry + sh);
          ctx.quadraticCurveTo(srx, sry + sh, srx, sry + sh - radius);
          ctx.lineTo(srx, sry + radius);
          ctx.quadraticCurveTo(srx, sry, srx + radius, sry);
          ctx.closePath();

          // Clip image to rounded rect
          ctx.clip();

          // Render image or color wheel placeholder if loading
          const cachedImg = imageCache.current[node.image];
          if (cachedImg && cachedImg.complete) {
            ctx.drawImage(cachedImg, srx, sry, sw, sh);
          } else {
            // Color segments placeholder
            drawPalettePie(node.x, node.y, sh / 2, node.palette);
            // Trigger load once
            if (!cachedImg) {
              const img = new Image();
              img.crossOrigin = "anonymous";
              img.src = node.image;
              img.onload = () => {
                imageCache.current[node.image] = img;
              };
              imageCache.current[node.image] = img;
            }
          }
          ctx.restore();

          // Card outline (border glow)
          ctx.strokeStyle = isSelected 
            ? "#ffffff" 
            : isHovered 
              ? node.primary 
              : "rgba(255, 255, 255, 0.2)";
          ctx.lineWidth = isSelected ? 3.0 : isHovered ? 2.0 : 1.0;

          // Draw rounded stroke path
          ctx.beginPath();
          ctx.moveTo(srx + radius, sry);
          ctx.lineTo(srx + sw - radius, sry);
          ctx.quadraticCurveTo(srx + sw, sry, srx + sw, sry + radius);
          ctx.lineTo(srx + sw, sry + sh - radius);
          ctx.quadraticCurveTo(srx + sw, sry + sh, srx + sw - radius, sry + sh);
          ctx.lineTo(srx + radius, sry + sh);
          ctx.quadraticCurveTo(srx, sry + sh, srx, sry + sh - radius);
          ctx.lineTo(srx, sry + radius);
          ctx.quadraticCurveTo(srx, sry, srx + radius, sry);
          ctx.closePath();
          ctx.stroke();

          // Text labels hovering above card
          if (isHovered || isSelected) {
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 11px sans-serif";
            ctx.textAlign = "center";
            ctx.shadowColor = "#000000";
            ctx.shadowBlur = 4;
            ctx.fillText(node.title, node.x, sry - 6);
            ctx.shadowBlur = 0; // Reset
          }
        }
      });

      ctx.restore();
      animFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [dimensions, zoomTransform, selectedPoster, searchQuery, showLinks, stars, clusterCenters]);

  // 8. Canvas Interaction: Mouse hover detection
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Calculate mouse position relative to canvas bounding box
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Un-project screen coords back to simulation world space
    const wx = (mx - zoomTransform.x) / zoomTransform.k;
    const wy = (my - zoomTransform.y) / zoomTransform.k;

    // Find closest node inside hover distance threshold
    let nearestNode: PosterNode | null = null;
    let minDistance = zoomTransform.k < 0.65 ? 16 / zoomTransform.k : 40;

    for (const node of nodesRef.current) {
      if (node.x === undefined || node.y === undefined) continue;
      const dx = node.x - wx;
      const dy = node.y - wy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < minDistance) {
        minDistance = dist;
        nearestNode = node;
      }
    }

    if (hoveredNodeRef.current?.id !== nearestNode?.id) {
      hoveredNodeRef.current = nearestNode;
      // Force repaint to draw title or updated outline immediately
      canvas.style.cursor = nearestNode ? "pointer" : "default";
    }
  };

  // Canvas Interaction: Mouse click locking selection
  const handleCanvasClick = () => {
    if (hoveredNodeRef.current) {
      setSelectedPoster(hoveredNodeRef.current);
    } else {
      setSelectedPoster(null);
    }
  };

  // 9. Camera warp / animation utilities
  const warpToPoster = (node: PosterNode) => {
    const canvas = canvasRef.current;
    if (!canvas || !zoomBehaviorRef.current || node.x === undefined || node.y === undefined) return;

    const targetScale = 1.35;
    const tx = dimensions.width / 2 - node.x * targetScale;
    const ty = dimensions.height / 2 - node.y * targetScale;

    d3.select(canvas)
      .transition()
      .duration(850)
      .ease(d3.easeCubicOut)
      .call(
        zoomBehaviorRef.current.transform,
        d3.zoomIdentity.translate(tx, ty).scale(targetScale)
      );

    setSelectedPoster(node);
  };

  const resetView = () => {
    const canvas = canvasRef.current;
    if (!canvas || !zoomBehaviorRef.current) return;

    d3.select(canvas)
      .transition()
      .duration(750)
      .call(
        zoomBehaviorRef.current.transform,
        d3.zoomIdentity.translate(dimensions.width / 2, dimensions.height / 2).scale(0.55)
      );

    setSelectedPoster(null);
  };

  const warpToRandom = () => {
    if (nodesRef.current.length === 0) return;
    const rand = nodesRef.current[Math.floor(Math.random() * nodesRef.current.length)];
    warpToPoster(rand);
  };

  // 10. Copy Hex Color Swatch helper
  const handleCopyColor = (hex: string) => {
    navigator.clipboard.writeText(hex);
    toast.success(`Copied swatch ${hex} to clipboard!`, {
      style: {
        background: "rgba(30, 30, 35, 0.8)",
        color: "#F5F5F5",
        borderColor: "rgba(255, 255, 255, 0.15)",
        backdropFilter: "blur(10px)"
      }
    });
  };

  // 11. Color Harmony derivations
  const selectedHarmonies = useMemo(() => {
    if (!selectedPoster) return [];
    return calculateHarmonies(selectedPoster.hsl.h, selectedPoster.hsl.s, selectedPoster.hsl.l);
  }, [selectedPoster]);

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "#0c0c10", color: "#F5F5F5" }}>
      {/* Header Navigation */}
      <Header showSearch={false} />

      <main 
        ref={containerRef} 
        className="relative flex-grow overflow-hidden select-none"
        style={{ height: "calc(100vh - 72px)" }}
      >
        {/* Render Canvas */}
        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          onMouseMove={handleMouseMove}
          onClick={handleCanvasClick}
          className="absolute inset-0 block h-full w-full outline-none"
        />

        {/* 12. Floating control elements (HUD) */}
        <div className="absolute right-4 bottom-4 flex flex-col gap-2 z-20">
          <div className="flex flex-col gap-1 overflow-hidden rounded-xl border border-white/10 bg-black/60 p-1.5 backdrop-blur-md shadow-2xl">
            <button
              onClick={() => {
                const canvas = canvasRef.current;
                if (canvas && zoomBehaviorRef.current) {
                  d3.select(canvas).transition().duration(250).call(zoomBehaviorRef.current.scaleBy, 1.35);
                }
              }}
              title="Zoom In"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ZoomIn size={18} />
            </button>
            <button
              onClick={() => {
                const canvas = canvasRef.current;
                if (canvas && zoomBehaviorRef.current) {
                  d3.select(canvas).transition().duration(250).call(zoomBehaviorRef.current.scaleBy, 0.7);
                }
              }}
              title="Zoom Out"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ZoomOut size={18} />
            </button>
            <button
              onClick={resetView}
              title="Reset View"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Compass size={18} />
            </button>
            <button
              onClick={() => setShowLinks(!showLinks)}
              title="Toggle Constellation Lines"
              className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${showLinks ? "text-[#FF6B6B]" : "text-white/40 hover:bg-white/10 hover:text-white"}`}
            >
              <Layers size={18} />
            </button>
          </div>
        </div>

        {/* 13. Search bar HUD */}
        <div className="absolute top-4 right-4 z-20 max-w-xs w-full">
          <div className="relative flex items-center rounded-full border border-white/10 bg-black/60 px-3 py-2 backdrop-blur-md shadow-lg">
            <Search className="text-white/40 mr-2 shrink-0" size={16} />
            <input
              type="text"
              placeholder="Search star systems..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-transparent text-xs text-white placeholder-white/40 outline-none"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery("")} 
                className="text-white/40 hover:text-white ml-1.5"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* 14. Responsive Glassmorphic Sidebar Drawer */}
        <div 
          className={`absolute top-0 bottom-0 left-0 w-80 sm:w-[410px] bg-[#0c0c10]/80 border-r border-white/10 backdrop-blur-xl z-20 shadow-2xl transition-transform duration-500 overflow-y-auto scrollbar-hide ${
            selectedPoster ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {selectedPoster ? (
            <div className="p-6">
              {/* Close Button */}
              <button
                onClick={() => setSelectedPoster(null)}
                className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-all"
              >
                <X size={16} />
              </button>

              <h2 
                style={{ fontFamily: "Bebas Neue, sans-serif" }} 
                className="text-3xl tracking-wider text-white pr-8 mb-4 border-b border-white/5 pb-2"
              >
                STAR CORE DETAILS
              </h2>

              {/* Poster Card Preview */}
              <div className="flex gap-4 mb-6">
                <div 
                  className="relative shrink-0 overflow-hidden rounded-md border border-white/10 shadow-lg aspect-[2/3] w-24 sm:w-28"
                  style={{ backgroundColor: "#121212" }}
                >
                  <img
                    src={selectedPoster.image}
                    alt={selectedPoster.title}
                    className="h-full w-full object-cover"
                  />
                  <div 
                    className="absolute inset-0 transition-opacity pointer-events-none"
                    style={{ boxShadow: `inset 0 0 0 2px ${selectedPoster.primary}` }}
                  />
                </div>

                <div className="flex flex-col justify-center min-w-0">
                  <h3 style={{ fontFamily: "Poppins, sans-serif" }} className="text-md sm:text-lg font-bold text-white leading-tight truncate">
                    {selectedPoster.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-[#FF6B6B] font-semibold truncate mt-1">
                    by {selectedPoster.artist}
                  </p>
                  <p className="text-xs text-white/50 mt-1">
                    Released: {selectedPoster.year || "Unknown"}
                  </p>
                  <span 
                    className="inline-block self-start text-[10px] uppercase font-mono tracking-widest px-2 py-0.5 rounded border border-white/10 bg-white/5 text-white/70 mt-2.5"
                    style={{ borderColor: selectedPoster.primary + "40" }}
                  >
                    {selectedPoster.style}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2.5 mb-6">
                <button
                  onClick={() => warpToPoster(selectedPoster)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-2 px-3 text-xs font-semibold text-white transition hover:bg-white/10"
                >
                  <Compass size={14} />
                  WARP CENTER
                </button>
                <button
                  onClick={() => setActiveLightboxPoster(selectedPoster as any)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#FF6B6B] py-2 px-3 text-xs font-semibold text-[#121212] transition hover:bg-[#FF8585] shadow-md shadow-[#FF6B6B]/15"
                >
                  <Eye size={14} />
                  VIEW THEATER
                </button>
              </div>

              {/* Dominant Palette Swatches */}
              <div className="mb-6 p-4 rounded-xl border border-white/10 bg-white/5">
                <h4 className="text-xs font-mono uppercase tracking-widest text-white/50 mb-3 flex items-center gap-1.5">
                  <Palette size={14} className="text-[#FF6B6B]" /> Dominant Palette
                </h4>
                <div className="grid grid-cols-5 gap-2 h-12 mb-2 rounded-lg overflow-hidden border border-white/10">
                  {selectedPoster.palette.map((hex, i) => (
                    <div
                      key={i}
                      style={{ backgroundColor: hex }}
                      title={`Copy ${hex}`}
                      onClick={() => handleCopyColor(hex)}
                      className="h-full w-full cursor-pointer transition-transform hover:scale-[1.08] hover:shadow-lg relative group"
                    >
                      <span className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <Copy size={12} className="text-white" />
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {selectedPoster.palette.map((hex, i) => (
                    <button
                      key={i}
                      onClick={() => handleCopyColor(hex)}
                      className="text-[10px] font-mono text-white/50 hover:text-white flex items-center gap-1 bg-white/5 rounded border border-white/5 px-1.5 py-0.5"
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: hex }} />
                      {hex}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Harmonies */}
              <div className="space-y-4 mb-6">
                <h4 className="text-xs font-mono uppercase tracking-widest text-white/50 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-[#FF6B6B]" /> Color Harmonies
                </h4>
                {selectedHarmonies.map((harmony, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5 rounded-lg border border-white/5 bg-white/0 hover:bg-white/5 transition-colors">
                    <span className="text-xs text-white/70">{harmony.name}</span>
                    <div className="flex gap-1 h-6 w-24 rounded border border-white/10 overflow-hidden">
                      {harmony.colors.map((hex, j) => (
                        <div
                          key={j}
                          style={{ backgroundColor: hex }}
                          title={`Copy ${hex}`}
                          onClick={() => handleCopyColor(hex)}
                          className="h-full flex-grow cursor-pointer transition-all hover:flex-grow-[1.5]"
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* System Cluster Stats */}
              <div className="p-4 rounded-xl border border-white/5 bg-white/0">
                <h4 className="text-xs font-mono uppercase tracking-widest text-white/50 mb-2 flex items-center gap-1.5">
                  <Info size={14} /> System coordinates
                </h4>
                <div className="text-[11px] font-mono text-white/40 space-y-1">
                  <div className="flex justify-between">
                    <span>Cluster Nebula:</span>
                    <span className="text-white/80" style={{ color: selectedPoster.clusterColor }}>
                      {selectedPoster.clusterName}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Hue Degree:</span>
                    <span className="text-white/80">{selectedPoster.hsl.h}°</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Saturation / Lightness:</span>
                    <span className="text-white/80">{selectedPoster.hsl.s}% / {selectedPoster.hsl.l}%</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* 15. Default Sidebar (Welcome & Stats) when nothing is selected */}
        <div 
          className={`absolute top-0 bottom-0 left-0 w-80 sm:w-[410px] bg-[#0c0c10]/60 border-r border-white/10 backdrop-blur-xl z-10 shadow-2xl transition-transform duration-500 overflow-y-auto scrollbar-hide ${
            !selectedPoster ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="p-6 flex flex-col min-h-full">
            <div className="flex-grow">
              <h2 
                style={{ fontFamily: "Bebas Neue, sans-serif" }} 
                className="text-4xl tracking-widest text-white mb-2"
              >
                COLOR CONSTELLATION
              </h2>
              <p className="text-xs text-white/50 leading-relaxed mb-6 font-mono">
                Explore an alternate visual coordinate plane where film poster designs are mathematically grouped by color hues. Clusters form gravity points in a deep galaxy system.
              </p>

              {/* Guide HUD */}
              <div className="mb-6 p-4 rounded-xl border border-white/10 bg-white/5">
                <h3 style={{ fontFamily: "Poppins, sans-serif" }} className="text-xs font-bold uppercase tracking-wider text-[#FF6B6B] mb-2.5">
                  Navigation Instructions
                </h3>
                <ul className="text-xs text-white/60 space-y-2 list-none pl-0">
                  <li className="flex gap-2">
                    <span className="text-[#FF6B6B] font-mono">PAN:</span> Drag standard mouse/trackpad to move coordinates.
                  </li>
                  <li className="flex gap-2">
                    <span className="text-[#FF6B6B] font-mono">ZOOM:</span> Scroll wheel or pinch/zoom to dive deeper.
                  </li>
                  <li className="flex gap-2">
                    <span className="text-[#FF6B6B] font-mono">SELECT:</span> Click a glowing star to scan detail readings.
                  </li>
                  <li className="flex gap-2">
                    <span className="text-[#FF6B6B] font-mono">CROSS-FADE:</span> Zoom in closely to transform stars into posters.
                  </li>
                </ul>
              </div>

              {/* Galaxy Clusters Stats breakdown */}
              <div className="space-y-3 mb-8">
                <h3 style={{ fontFamily: "Poppins, sans-serif" }} className="text-xs font-bold uppercase tracking-wider text-white/50">
                  Nebula Sectors Count
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {Object.values(CLUSTERS).map(cluster => {
                    const count = clusterStats[cluster.id] || 0;
                    return (
                      <div 
                        key={cluster.id} 
                        className="p-2.5 rounded-lg border border-white/5 bg-white/0 hover:border-white/15 transition-all"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse" style={{ backgroundColor: cluster.color }} />
                          <span className="text-[11px] font-medium text-white/80 truncate">{cluster.name}</span>
                        </div>
                        <p className="text-lg font-bold text-white mt-1 pl-4 font-mono">
                          {count} <span className="text-[10px] text-white/40 font-normal">stars</span>
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Randomizer Footer button */}
            <div className="mt-auto border-t border-white/5 pt-4">
              <button
                onClick={warpToRandom}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold py-3 text-xs transition"
              >
                <Sparkles size={14} className="text-[#FF6B6B]" />
                WARP TO RANDOM STAR
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Expanded Theater Lightbox */}
      <Lightbox
        poster={activeLightboxPoster}
        posters={posters}
        onNavigate={setActiveLightboxPoster}
        onClose={() => setActiveLightboxPoster(null)}
      />
    </div>
  );
}
