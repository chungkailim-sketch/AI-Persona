/**
 * The market-potential map: China and the study's markets on a bundled world map (no tiles, no
 * request leaves the server), a line from China to each market and a bubble sized and coloured by
 * the market's index. Rendered on the server as plain SVG, so it prints exactly as it shows.
 */
import { geoCentroid, geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import world110 from 'world-atlas/countries-110m.json';
import world50 from 'world-atlas/countries-50m.json';
import type { PotentialRow, TierKey } from '@/roundtable/marketIndex';

type Countries = GeoJSON.FeatureCollection<GeoJSON.Geometry, { name: string }>;

const ALIASES: Record<string, string> = {
  uk: 'United Kingdom', 'great britain': 'United Kingdom', britain: 'United Kingdom',
  us: 'United States of America', usa: 'United States of America', 'united states': 'United States of America', america: 'United States of America',
  korea: 'South Korea', 'republic of korea': 'South Korea', 'korea, south': 'South Korea',
  uae: 'United Arab Emirates', ksa: 'Saudi Arabia', 'viet nam': 'Vietnam',
  'mainland china': 'China', prc: 'China', 'hong kong sar': 'Hong Kong', hk: 'Hong Kong',
  czechia: 'Czechia', 'czech republic': 'Czechia', turkiye: 'Turkey', türkiye: 'Turkey',
};

let centroids: Map<string, [number, number]> | null = null;
function centroidTable(): Map<string, [number, number]> {
  if (centroids) return centroids;
  const topo = world50 as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const fc = feature(topo, topo.objects.countries) as unknown as Countries;
  centroids = new Map(fc.features.map((f) => [f.properties.name.toLowerCase(), geoCentroid(f as GeoPermissibleObjects) as [number, number]]));
  return centroids;
}

/** Longitude and latitude for a market as the data names it, or null when it cannot be placed. */
export function locate(market: string): [number, number] | null {
  const key = market.trim().toLowerCase();
  const name = (ALIASES[key] ?? market).toLowerCase();
  return centroidTable().get(name) ?? null;
}

let land: Countries | null = null;
function landShapes(): Countries {
  if (land) return land;
  const topo = world110 as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  land = feature(topo, topo.objects.countries) as unknown as Countries;
  return land;
}

export const TIER_FILL: Record<TierKey, string> = {
  priority: 'var(--tier-priority)',
  build: 'var(--tier-build)',
  selective: 'var(--tier-selective)',
  watch: 'var(--tier-watch)',
};

export function MarketMap({ rows, width = 760, height = 400 }: { rows: PotentialRow[]; width?: number; height?: number }) {
  const china = locate('China')!;
  const placed = rows.map((r) => ({ r, at: locate(r.market) })).filter((x): x is { r: PotentialRow; at: [number, number] } => x.at !== null);
  const pts = [china, ...placed.map((p) => p.at)];
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const pad = 12;
  const frame: GeoJSON.Feature = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPoint', coordinates: [[Math.min(...lons) - pad, Math.min(...lats) - pad], [Math.max(...lons) + pad, Math.max(...lats) + pad]] },
  };
  const projection = geoNaturalEarth1().fitExtent([[24, 24], [width - 24, height - 24]], frame);
  const path = geoPath(projection);
  const [cx, cy] = projection(china)!;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Map of the markets, with each market's index shown as a bubble" className="h-auto w-full">
      <defs>
        <clipPath id="map-clip"><rect width={width} height={height} rx="6" /></clipPath>
      </defs>
      <g clipPath="url(#map-clip)">
        <rect width={width} height={height} fill="var(--map-sea)" />
        {landShapes().features.map((f, i) => (
          <path key={i} d={path(f) ?? undefined} fill="var(--map-land)" stroke="var(--map-border)" strokeWidth={0.5} />
        ))}
        {placed.map(({ r, at }) => {
          const [x, y] = projection(at)!;
          const mx = (cx + x) / 2;
          const my = Math.min(cy, y) - Math.abs(x - cx) * 0.18 - 12;
          return <path key={`l-${r.market}`} d={`M${cx},${cy} Q${mx},${my} ${x},${y}`} fill="none" stroke="var(--color-brand-mark)" strokeWidth={1.2} strokeDasharray="3 4" opacity={0.8} />;
        })}
        <circle cx={cx} cy={cy} r={7} fill="var(--color-highlight)" stroke="var(--slide-paper)" strokeWidth={1.5} />
        <text x={cx} y={cy - 12} textAnchor="middle" className="fill-ink text-[12px] font-bold">China</text>
        {placed.map(({ r, at }) => {
          const [x, y] = projection(at)!;
          const radius = 8 + ((r.score ?? 0) / 100) * 18;
          const left = x > width * 0.72;
          const tx = left ? x - radius - 6 : x + radius + 6;
          return (
            <g key={r.market}>
              <circle cx={x} cy={y} r={radius} fill={r.tier ? TIER_FILL[r.tier] : 'var(--tier-watch)'} fillOpacity={0.88} stroke="var(--slide-paper)" strokeWidth={1.5} />
              <text x={x} y={y + 4} textAnchor="middle" className="text-[11px] font-bold" fill="var(--slide-paper)">{r.score === null ? '–' : Math.round(r.score)}</text>
              <text x={tx} y={y - 2} textAnchor={left ? 'end' : 'start'} className="fill-ink text-[12px] font-bold">{r.market}</text>
              <text x={tx} y={y + 12} textAnchor={left ? 'end' : 'start'} className="fill-ink-muted text-[10px]">
                {r.topCategories.map((c) => `${c.category} ${c.score}`).join(' · ')}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
