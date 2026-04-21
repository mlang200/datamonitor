import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as api from '../api';
import type { PlanningDeskMatch, BblMappedEvent } from '../api';
import { useBblSocket } from '../hooks/useBblSocket';
import { useProductionWindow } from '../hooks/useProductionWindow';
import { useAuth } from '../auth/AuthContext';
import type { GameInfo } from '../hooks/useBblSocket';
import {
  buildRosterMap, buildStateFromEvents, getLeaders, getPlayEvents,
  formatClock, pct, shotStr, generateInsights,
  type PlayerStats, type PlayEvent, type LiveInsight,
} from './dashboard-logic';

// ═══════════════════════════════════════════════
// Constants & Styles
// ═══════════════════════════════════════════════

const C = {
  bg: '#011326', card: '#01192e', border: '#0d2a42', borderLight: '#163a56',
  accent: '#22d2e6', accentDim: 'rgba(34,210,230,0.12)', text: '#c1d1e1', textMuted: '#4a6a85',
  textDim: '#2e4a62', success: '#00c853', warning: '#ff9100', danger: '#ff3d3d', white: '#fff',
  tableHeader: '#071e33', tableRowAlt: 'rgba(13,42,66,0.4)',
};

const btn = (active?: boolean): React.CSSProperties => ({
  padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  border: `1px solid ${active ? C.accent : C.borderLight}`, borderRadius: 4,
  background: active ? C.accent : C.card, color: active ? '#011326' : C.text,
});

const selectStyle: React.CSSProperties = {
  flex: 1, maxWidth: 560, padding: '8px 12px', fontSize: 13,
  background: C.bg, color: C.text, border: `1px solid ${C.borderLight}`, borderRadius: 4, outline: 'none',
};

// ═══════════════════════════════════════════════
// Helper functions (pct, shotStr, formatClock imported from dashboard-logic)
// ═══════════════════════════════════════════════

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// ═══════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════

function InsightsPanel({ insights }: { insights: LiveInsight[] }) {
  if (insights.length === 0) return null;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '6px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: C.textMuted }}>
        💡 Live Insights
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {insights.map((ins, i) => (
          <div key={i} style={{ padding: '6px 12px', borderBottom: i < insights.length - 1 ? `1px solid ${C.border}` : 'none', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 14, flexShrink: 0, lineHeight: '18px' }}>{ins.icon}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.white, lineHeight: '16px' }}>{ins.headline}</div>
              <div style={{ fontSize: 11, color: C.text, lineHeight: '15px' }}>{ins.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeadersPanel({ playersA, playersB, tlcA, tlcB, homeColor, guestColor }: {
  playersA: PlayerStats[]; playersB: PlayerStats[];
  tlcA: string; tlcB: string; homeColor: string; guestColor: string;
}) {
  const cats: { label: string; field: keyof PlayerStats }[] = [
    { label: 'PTS', field: 'pts' }, { label: 'REB', field: 'reb' },
    { label: 'AST', field: 'ast' }, { label: 'STL', field: 'stl' }, { label: 'BS', field: 'bl' },
  ];
  function best(ps: PlayerStats[], f: keyof PlayerStats) {
    return ps.length > 0 ? ps.reduce((a, b) => (b[f] as number) > (a[f] as number) ? b : a, ps[0]) : null;
  }
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: C.textMuted }}>🏆 Team Leaders</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr' }}>
        <div style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, color: homeColor, borderBottom: `1px solid ${C.border}` }}>{tlcA}</div>
        <div style={{ padding: '8px 14px', fontSize: 10, fontWeight: 700, color: C.textMuted, textAlign: 'center', borderBottom: `1px solid ${C.border}` }}>STAT</div>
        <div style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, color: guestColor, textAlign: 'right', borderBottom: `1px solid ${C.border}` }}>{tlcB}</div>
        {cats.map(cat => {
          const hl = best(playersA, cat.field);
          const gl = best(playersB, cat.field);
          return (
            <React.Fragment key={cat.label}>
              <div style={{ padding: '8px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                {hl ? <><span style={{ fontSize: 18, fontWeight: 800, color: C.white, minWidth: 28 }}>{hl[cat.field] as number}</span><span style={{ fontSize: 12, color: C.text }}>#{hl.number} {hl.lastName}</span></> : <span style={{ color: C.textDim }}>—</span>}
              </div>
              <div style={{ padding: '8px 14px', textAlign: 'center', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{cat.label}</div>
              <div style={{ padding: '8px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                {gl ? <><span style={{ fontSize: 12, color: C.text }}>{gl.lastName} #{gl.number}</span><span style={{ fontSize: 18, fontWeight: 800, color: C.white, minWidth: 28, textAlign: 'right' }}>{gl[cat.field] as number}</span></> : <span style={{ color: C.textDim }}>—</span>}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function TeamTable({ players, teamName, tlc, score, accentColor }: {
  players: PlayerStats[]; teamName: string; tlc: string; score: number; accentColor: string;
}) {
  type Col = { key: string; label: string; w: number; render: (p: PlayerStats) => React.ReactNode };
  const cols: Col[] = [
    { key: '#', label: '#', w: 30, render: p => <span style={{ color: C.textMuted }}>{p.number || '—'}</span> },
    { key: 'name', label: 'SPIELER', w: 150, render: p => <span style={{ fontWeight: 600, color: C.white }}>{p.firstName} {p.lastName}</span> },
    { key: 'min', label: 'MIN', w: 48, render: p => { const m = Math.floor(p.sp / 60); const s = Math.round(p.sp % 60); return <span style={{ color: C.textMuted }}>{p.sp > 0 ? `${m}:${String(s).padStart(2, '0')}` : '—'}</span>; } },
    { key: 'pts', label: 'PTS', w: 42, render: p => <span style={{ fontWeight: 700, color: p.pts > 0 ? C.accent : C.textDim }}>{p.pts}</span> },
    { key: '2p', label: '2P', w: 62, render: p => <>{shotStr(p.twoPM, p.twoPA)} <span style={{ color: C.textDim, fontSize: 10 }}>({pct(p.twoPM, p.twoPA)})</span></> },
    { key: '3p', label: '3P', w: 62, render: p => <>{shotStr(p.threePM, p.threePA)} <span style={{ color: p.threePA > 0 && p.threePM / p.threePA >= 0.4 ? C.success : C.textDim, fontSize: 10 }}>({pct(p.threePM, p.threePA)})</span></> },
    { key: 'fg', label: 'FG', w: 62, render: p => <>{shotStr(p.fgm, p.fga)} <span style={{ color: C.textDim, fontSize: 10 }}>({pct(p.fgm, p.fga)})</span></> },
    { key: 'ft', label: 'FT', w: 62, render: p => <>{shotStr(p.ftm, p.fta)} <span style={{ color: p.fta > 0 && p.ftm / p.fta >= 0.8 ? C.success : C.textDim, fontSize: 10 }}>({pct(p.ftm, p.fta)})</span></> },
    { key: 'reb', label: 'REB', w: 36, render: p => p.reb },
    { key: 'ast', label: 'AST', w: 36, render: p => p.ast },
    { key: 'stl', label: 'STL', w: 36, render: p => p.stl },
    { key: 'to', label: 'TO', w: 36, render: p => <span style={{ color: p.tov > 3 ? C.danger : 'inherit' }}>{p.tov}</span> },
    { key: 'bs', label: 'BS', w: 36, render: p => p.bl },
    { key: 'pf', label: 'PF', w: 36, render: p => <span style={{ color: p.foul >= 5 ? C.danger : p.foul >= 4 ? C.warning : 'inherit', fontWeight: p.foul >= 4 ? 700 : 400 }}>{p.foul}</span> },
    { key: 'eff', label: 'EFF', w: 42, render: p => <span style={{ fontWeight: 600, color: p.eff > 10 ? C.success : p.eff < 0 ? C.danger : C.text }}>{p.eff}</span> },
  ];
  const hasPlayers = players.length > 0;
  const t = players.reduce((acc, p) => ({
    pts: acc.pts + p.pts, twoPM: acc.twoPM + p.twoPM, twoPA: acc.twoPA + p.twoPA,
    threePM: acc.threePM + p.threePM, threePA: acc.threePA + p.threePA,
    fgm: acc.fgm + p.fgm, fga: acc.fga + p.fga, ftm: acc.ftm + p.ftm, fta: acc.fta + p.fta,
    reb: acc.reb + p.reb, ast: acc.ast + p.ast, stl: acc.stl + p.stl, tov: acc.tov + p.tov,
    bl: acc.bl + p.bl, foul: acc.foul + p.foul, eff: acc.eff + p.eff,
  }), { pts: 0, twoPM: 0, twoPA: 0, threePM: 0, threePA: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, tov: 0, bl: 0, foul: 0, eff: 0 });

  return (
    <div style={{ background: C.card, border: `2px solid ${accentColor}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', background: `${accentColor}18`, borderBottom: `1px solid ${accentColor}40`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: C.white, letterSpacing: 1 }}>{tlc || '—'}</span>
        <span style={{ fontSize: 12, color: C.textMuted }}>{teamName}</span>
        <span style={{ marginLeft: 'auto', fontSize: 22, fontWeight: 800, color: C.white }}>{score || '—'}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 750 }}>
          <thead><tr style={{ background: C.tableHeader }}>
            {cols.map(c => <th key={c.key} style={{ padding: '8px 5px', textAlign: c.key === 'name' ? 'left' : 'center', color: C.textMuted, fontWeight: 700, fontSize: 10, letterSpacing: 1, borderBottom: `1px solid ${C.border}`, width: c.w, whiteSpace: 'nowrap' }}>{c.label}</th>)}
          </tr></thead>
          <tbody>
            {hasPlayers ? players.map((p, i) => (
              <tr key={p.playerId} style={{ background: i % 2 === 0 ? 'transparent' : C.tableRowAlt }}>
                {cols.map(c => <td key={c.key} style={{ padding: '7px 5px', textAlign: c.key === 'name' ? 'left' : 'center', color: C.text, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{c.render(p)}</td>)}
              </tr>
            )) : Array.from({ length: 5 }).map((_, i) => (
              <tr key={`e-${i}`} style={{ background: i % 2 === 0 ? 'transparent' : C.tableRowAlt }}>
                {cols.map(c => <td key={c.key} style={{ padding: '7px 5px', textAlign: 'center', color: C.textDim, borderBottom: `1px solid ${C.border}` }}>—</td>)}
              </tr>
            ))}
            <tr style={{ background: 'rgba(34,210,230,0.06)' }}>
              <td style={{ padding: '8px 5px', borderTop: `2px solid ${C.accent}` }} />
              <td style={{ padding: '8px 5px', textAlign: 'left', fontWeight: 700, color: C.accent, borderTop: `2px solid ${C.accent}`, fontSize: 11 }}>TEAM</td>
              <td style={{ padding: '8px 5px', textAlign: 'center', color: C.textDim, borderTop: `2px solid ${C.accent}` }}>—</td>
              <td style={{ padding: '8px 5px', textAlign: 'center', fontWeight: 800, color: C.white, borderTop: `2px solid ${C.accent}` }}>{t.pts || '—'}</td>
              {hasPlayers ? <>
                <td style={{ padding: '8px 5px', textAlign: 'center', color: C.text, borderTop: `2px solid ${C.accent}` }}>{shotStr(t.twoPM, t.twoPA)} <span style={{ color: C.textDim, fontSize: 10 }}>({pct(t.twoPM, t.twoPA)})</span></td>
                <td style={{ padding: '8px 5px', textAlign: 'center', color: C.text, borderTop: `2px solid ${C.accent}` }}>{shotStr(t.threePM, t.threePA)} <span style={{ color: C.textDim, fontSize: 10 }}>({pct(t.threePM, t.threePA)})</span></td>
                <td style={{ padding: '8px 5px', textAlign: 'center', color: C.text, borderTop: `2px solid ${C.accent}` }}>{shotStr(t.fgm, t.fga)} <span style={{ color: C.textDim, fontSize: 10 }}>({pct(t.fgm, t.fga)})</span></td>
                <td style={{ padding: '8px 5px', textAlign: 'center', color: C.text, borderTop: `2px solid ${C.accent}` }}>{shotStr(t.ftm, t.fta)} <span style={{ color: C.textDim, fontSize: 10 }}>({pct(t.ftm, t.fta)})</span></td>
              </> : Array.from({ length: 4 }).map((_, i) => <td key={i} style={{ padding: '8px 5px', textAlign: 'center', color: C.textDim, borderTop: `2px solid ${C.accent}` }}>—</td>)}
              {['reb', 'ast', 'stl', 'tov', 'bl', 'foul', 'eff'].map(k => (
                <td key={k} style={{ padding: '8px 5px', textAlign: 'center', color: k === 'eff' ? C.accent : C.text, fontWeight: k === 'eff' ? 700 : 400, borderTop: `2px solid ${C.accent}` }}>{(t as Record<string, number>)[k] || '—'}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Score Flow Timeline
// ═══════════════════════════════════════════════

const QUARTER_DURATION = 600; // 10 min per quarter in seconds
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

function parseClock(clock: string): number {
  const parts = clock.split(':');
  if (parts.length !== 2) return 0;
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function eventToX(quarter: string, clock: string, width: number): number {
  const qIdx = QUARTERS.indexOf(quarter);
  if (qIdx === -1) {
    // OT quarters
    const otMatch = quarter.match(/OT(\d+)/);
    if (!otMatch) return width;
    const otIdx = parseInt(otMatch[1], 10) - 1;
    const elapsed = QUARTER_DURATION - parseClock(clock);
    return ((4 + otIdx) / (4 + otIdx + 1)) * width + (elapsed / QUARTER_DURATION) * (width / (4 + otIdx + 1));
  }
  const elapsed = QUARTER_DURATION - parseClock(clock);
  const qWidth = width / 4;
  return qIdx * qWidth + (elapsed / QUARTER_DURATION) * qWidth;
}

function ScoreFlowTimeline({ events, homeColor, guestColor, homeTlc, guestTlc }: {
  events: PlayEvent[]; homeColor: string; guestColor: string; homeTlc: string; guestTlc: string;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const scoringEvents = events.filter(e => e.isScoring && e.scoreA != null && e.scoreB != null);
  if (scoringEvents.length < 2) return null;

  const W = 1000;
  const H = 100;
  const MID = H / 2;
  const PAD_TOP = 8;
  const PAD_BOT = 8;

  // Build score-diff path: positive = home leads, negative = guest leads
  const maxDiff = Math.max(1, ...scoringEvents.map(e => Math.abs((e.scoreA ?? 0) - (e.scoreB ?? 0))));
  const yScale = (MID - PAD_TOP - 4) / maxDiff;

  // Build path points
  const points: { x: number; y: number; ev: PlayEvent }[] = [{ x: 0, y: MID, ev: scoringEvents[0] }];
  for (const ev of scoringEvents) {
    const x = eventToX(ev.quarter, ev.clock, W);
    const diff = (ev.scoreA ?? 0) - (ev.scoreB ?? 0);
    const y = MID - diff * yScale;
    points.push({ x, y, ev });
  }

  // SVG path
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

  // Area fill: home above midline, guest below
  const homeAreaD = `M0,${MID} ${points.map(p => `L${p.x},${Math.min(p.y, MID)}`).join(' ')} L${points[points.length - 1].x},${MID} Z`;
  const guestAreaD = `M0,${MID} ${points.map(p => `L${p.x},${Math.max(p.y, MID)}`).join(' ')} L${points[points.length - 1].x},${MID} Z`;

  // Quarter dividers
  const qDividers = [1, 2, 3].map(i => (i / 4) * W);

  // Timeout markers
  const timeouts = events.filter(e => e.action === 'TIMEO' || e.action === 'TTO');

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * W;
    // Find closest scoring event
    let closest = points[0];
    let minDist = Infinity;
    for (const p of points) {
      const dist = Math.abs(p.x - mouseX);
      if (dist < minDist) { minDist = dist; closest = p; }
    }
    if (minDist < 30 && closest.ev.scoreA != null) {
      const diff = (closest.ev.scoreA ?? 0) - (closest.ev.scoreB ?? 0);
      const leader = diff > 0 ? homeTlc : diff < 0 ? guestTlc : 'Tie';
      const lastName = closest.ev.playerName.split(' ').pop() || '';
      setTooltip({
        x: e.clientX - (svgRef.current?.getBoundingClientRect().left ?? 0),
        y: e.clientY - (svgRef.current?.getBoundingClientRect().top ?? 0) - 30,
        text: `${closest.ev.quarter} ${closest.ev.clock} · ${closest.ev.scoreA}:${closest.ev.scoreB} · ${leader} ${diff > 0 ? '+' : ''}${diff} · #${closest.ev.playerNum} ${lastName}`,
      });
    } else {
      setTooltip(null);
    }
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
      <div style={{ padding: '6px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: C.textMuted, display: 'flex', alignItems: 'center', gap: 12 }}>
        📈 Score Flow
        <span style={{ fontSize: 9, fontWeight: 400, color: homeColor }}>▲ {homeTlc}</span>
        <span style={{ fontSize: 9, fontWeight: 400, color: guestColor }}>▼ {guestTlc}</span>
      </div>
      <div style={{ position: 'relative', padding: '0 12px 4px' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', height: 80, display: 'block' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
        >
          {/* Home area (above midline) */}
          <path d={homeAreaD} fill={homeColor} opacity={0.15} />
          {/* Guest area (below midline) */}
          <path d={guestAreaD} fill={guestColor} opacity={0.15} />

          {/* Midline (tie line) */}
          <line x1={0} y1={MID} x2={W} y2={MID} stroke={C.border} strokeWidth={0.5} strokeDasharray="4,4" />

          {/* Quarter dividers */}
          {qDividers.map((x, i) => (
            <g key={i}>
              <line x1={x} y1={0} x2={x} y2={H} stroke={C.border} strokeWidth={0.5} />
              <text x={x - 2} y={H - 2} textAnchor="end" fontSize={7} fill={C.textDim}>{QUARTERS[i]}</text>
            </g>
          ))}
          <text x={W - 2} y={H - 2} textAnchor="end" fontSize={7} fill={C.textDim}>Q4</text>

          {/* Timeout markers */}
          {timeouts.map((t, i) => {
            const x = eventToX(t.quarter, t.clock, W);
            return <line key={`to-${i}`} x1={x} y1={2} x2={x} y2={H - 2} stroke={C.textDim} strokeWidth={0.5} strokeDasharray="2,2" opacity={0.5} />;
          })}

          {/* Score diff line */}
          <path d={pathD} fill="none" stroke={C.accent} strokeWidth={1.5} />

          {/* Scoring dots */}
          {points.slice(1).map((p, i) => {
            const isHome = p.ev.teamCode === 'A';
            return (
              <circle
                key={i}
                cx={p.x} cy={p.y}
                r={p.ev.action === 'P3' ? 3 : p.ev.action === 'FT' ? 1.5 : 2}
                fill={isHome ? homeColor : guestColor}
                opacity={0.8}
              />
            );
          })}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div style={{
            position: 'absolute', left: tooltip.x, top: tooltip.y,
            background: '#000', color: '#fff', padding: '3px 8px', borderRadius: 4,
            fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', pointerEvents: 'none',
            transform: 'translateX(-50%)', zIndex: 10,
          }}>
            {tooltip.text}
          </div>
        )}
      </div>
    </div>
  );
}

function PlayByPlayTimeline({ events, homeColor, guestColor, historyIncomplete }: {
  events: PlayEvent[]; homeColor: string; guestColor: string; historyIncomplete: boolean;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = 0;
  }, [events.length]);

  const reversed = [...events].reverse();

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: C.textMuted, flexShrink: 0 }}>
        📋 Live Play-by-Play ({events.length})
      </div>
      {historyIncomplete && (
        <div style={{
          padding: '6px 12px', background: 'rgba(255,145,0,0.12)', borderBottom: `1px solid ${C.warning}`,
          fontSize: 11, color: C.warning, fontWeight: 600, flexShrink: 0,
        }}>
          ⚠️ Play-by-Play möglicherweise unvollständig — späte Verbindung oder Reconnect
        </div>
      )}
      <div ref={feedRef} style={{ flex: 1, overflowY: 'auto' }}>
        {reversed.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: C.textDim, fontSize: 12 }}>
            {events.length === 0 ? 'Warte auf Live-Events...' : 'Keine Events'}
          </div>
        )}
        {reversed.map((ev, i) => {
          const isHome = ev.teamCode === 'A';
          const color = isHome ? homeColor : guestColor;
          return (
            <div key={`${ev.id}-${i}`} style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: `1px solid ${C.border}`, alignItems: 'center', fontSize: 11, background: ev.isScoring ? 'rgba(34,210,230,0.04)' : 'transparent' }}>
              <span style={{ color: C.accent, minWidth: 20, fontSize: 10, fontWeight: 600 }}>{ev.quarter}</span>
              <span style={{ color: C.textDim, minWidth: 30, fontSize: 10, fontFamily: 'monospace' }}>{ev.clock}</span>
              <span style={{ fontSize: 12, minWidth: 14 }}>{ev.icon}</span>
              <span style={{ color, fontWeight: 700, minWidth: 14 }}>{ev.teamCode}</span>
              <span style={{ color: C.white, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ev.playerNum ? `#${ev.playerNum} ` : ''}{ev.playerName.split(' ').pop()}
              </span>
              <span style={{ color: C.textMuted, fontSize: 10, flexShrink: 0 }}>{ev.detail.split(' ')[0]}</span>
              {ev.scoreA != null && ev.scoreB != null && (
                <span style={{ color: C.accent, fontSize: 10, fontWeight: 700, fontFamily: 'monospace', flexShrink: 0 }}>{ev.scoreA}:{ev.scoreB}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// MAIN Dashboard
// ═══════════════════════════════════════════════

export default function BblSocketDashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [matches, setMatches] = useState<PlanningDeskMatch[]>([]);
  const [selectedMatchIdx, setSelectedMatchIdx] = useState<string>('');
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeColor, setHomeColor] = useState('#22d2e6');
  const [guestColor, setGuestColor] = useState('#ff9100');
  const termRef = useRef<HTMLDivElement>(null);

  const { state: ws, connect: wsConnect, disconnect: wsDisconnect } = useBblSocket();

  // Load matches (only basketball with bblscb scope)
  useEffect(() => {
    setLoadingMatches(true);
    api.getPlanningDeskMatches('basketball')
      .then(all => {
        const filtered = all.filter(m => m.gamedayScope === 'bblscb');
        setMatches(filtered);
        if (filtered.length > 0) setSelectedMatchIdx('0');
      })
      .catch(() => setMatches([]))
      .finally(() => setLoadingMatches(false));
  }, []);

  const selectedMatch = selectedMatchIdx !== '' ? matches[Number(selectedMatchIdx)] : null;
  const bblGameId = selectedMatch?.gamedayExternalId ? Number(selectedMatch.gamedayExternalId) : null;

  // Production window — auto-connect/disconnect based on match schedule
  const prodWindow = useProductionWindow(
    selectedMatch?.scheduledAt ?? null,
    bblGameId,
    ws.connected,
    ws.wsReady,
    wsConnect,
    wsDisconnect,
  );

  // Roster-Map from GameInfo
  const rosterMap = useMemo(() => buildRosterMap(ws.gameInfo as any), [ws.gameInfo]);

  // State from events
  const state = useMemo(() => buildStateFromEvents(ws.events, rosterMap), [ws.events, rosterMap]);

  // Determine live-event coverage start time (quarter/clock) from first play event
  const coverageStart = useMemo(() => {
    if (state.playEvents.length === 0) return null;
    const first = state.playEvents[0];
    return { quarter: first.quarter, clock: first.clock };
  }, [state.playEvents]);

  // Connect
  const handleConnect = useCallback(() => {
    if (!bblGameId) return;
    setConnecting(true);
    setError(null);
    wsConnect(bblGameId);
    setTimeout(() => setConnecting(false), 2000);
  }, [bblGameId, wsConnect]);

  // Disconnect
  const handleDisconnect = useCallback(() => {
    wsDisconnect();
  }, [wsDisconnect]);

  // Terminal auto-scroll
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [ws.logs]);

  // Team info from GameInfo or Planning Desk
  const gi = ws.gameInfo as any;
  const homeTeamName = gi?.homeTeam?.name || selectedMatch?.homeTeam || '—';
  const guestTeamName = gi?.guestTeam?.name || selectedMatch?.guestTeam || '—';
  const homeTlc = gi?.homeTeam?.TLC || '';
  const guestTlc = gi?.guestTeam?.TLC || '';
  const hasData = ws.connected && ws.historyLoaded && (state.playersA.length > 0 || state.playersB.length > 0);
  const showScore = ws.connected && ws.historyLoaded && state.scoreA + state.scoreB > 0;
  // Stats are only considered ready when players have actual game data (sp > 0 = played minutes).
  // After a reconnect with incomplete history, the roster is populated from GameInfo but
  // player stats may all be zero until the next player-stats event arrives.
  // We check: at least one player must have sp > 0 (has played) to consider stats valid.
  const hasRealPlayerStats = [...state.playersA, ...state.playersB].some(p => p.sp > 0);
  const statsReady = hasData && hasRealPlayerStats;

  // Live Insights
  const insights = useMemo(() => generateInsights(
    state.playEvents, state.playersA, state.playersB,
    homeTlc || selectedMatch?.homeTeam || 'A',
    guestTlc || selectedMatch?.guestTeam || 'B',
  ), [state.playEvents, state.playersA, state.playersB, homeTlc, guestTlc, selectedMatch]);

  return (
    <div style={{ padding: 24, background: C.bg, minHeight: '100vh', color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <select value={selectedMatchIdx} onChange={e => { setSelectedMatchIdx(e.target.value); handleDisconnect(); }} style={selectStyle} disabled={loadingMatches || connecting}>
          {matches.length === 0 && <option value="">{loadingMatches ? 'Lade Spiele...' : 'Keine Spiele'}</option>}
          {matches.map((m, idx) => (
            <option key={m.uuid} value={String(idx)}>
              {m.homeTeam} vs {m.guestTeam} · {formatDate(m.scheduledAt)} {formatTime(m.scheduledAt)}{m.competitionName ? ` · ${m.competitionName}` : ''}
            </option>
          ))}
        </select>
        {isAdmin && (ws.connected ? (
          <button onClick={handleDisconnect} style={{ ...btn(), background: C.danger, color: '#fff', border: `1px solid ${C.danger}` }}>⏹ Trennen</button>
        ) : (
          <button onClick={handleConnect} disabled={!bblGameId || connecting} style={{ ...btn(true), opacity: !bblGameId || connecting ? 0.5 : 1 }}>
            {connecting ? '⏳ Verbinde...' : '🔌 Verbinden'}
          </button>
        ))}
        {ws.connected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.success, animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: 11, color: C.success, fontWeight: 700 }}>LIVE</span>
            <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 4 }}>{ws.events.length} events</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <label style={{ fontSize: 11, color: C.textMuted }}>Heim</label>
          <input type="color" value={homeColor} onChange={e => setHomeColor(e.target.value)} style={{ width: 28, height: 28, border: 'none', cursor: 'pointer', background: 'transparent' }} />
          <label style={{ fontSize: 11, color: C.textMuted }}>Gast</label>
          <input type="color" value={guestColor} onChange={e => setGuestColor(e.target.value)} style={{ width: 28, height: 28, border: 'none', cursor: 'pointer', background: 'transparent' }} />
        </div>
      </div>

      {/* Socket Terminal — Admin only */}
      {isAdmin && (
      <div style={{
        background: '#0c0c0c', border: `1px solid ${C.border}`, borderRadius: 6,
        marginBottom: 16, overflow: 'hidden', fontFamily: '"Fira Code", "Cascadia Code", "Consolas", monospace',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: '#1a1a2e', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: ws.connected ? '#00c853' : ws.wsReady ? '#ff9100' : '#ff3d3d' }} />
          <span style={{ fontSize: 10, color: '#6a6a8a', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>{ws.connected ? 'live' : ws.wsReady ? 'bereit' : 'offline'}</span>
          <span style={{ fontSize: 10, color: '#4a4a6a', marginLeft: 'auto' }}>{bblGameId ? `game:${bblGameId}` : 'idle'}</span>
          {ws.connected && <span style={{ fontSize: 10, color: '#4a4a6a', marginLeft: 8 }}>{ws.events.length} events</span>}
          {coverageStart && (
            <span style={{ fontSize: 10, color: C.accent, marginLeft: 8 }}>
              live ab {coverageStart.quarter} {coverageStart.clock}
            </span>
          )}
          {prodWindow.label && (
            <span style={{ fontSize: 10, color: prodWindow.isActive ? C.success : C.textMuted, marginLeft: 8 }}>
              {prodWindow.label}
            </span>
          )}
        </div>
        <div ref={termRef} style={{ maxHeight: 96, overflowY: 'auto', padding: '6px 12px' }}>
          {ws.logs.length === 0 && (
            <div style={{ fontSize: 11, color: '#3a3a5a' }}>$ waiting for connection...</div>
          )}
          {ws.logs.map((l, i) => (
            <div key={i} style={{ fontSize: 11, lineHeight: 1.6, color: l.msg.includes('error') || l.msg.includes('disconnect') ? '#ff6b6b' : l.msg.includes('connected') || l.msg.includes('success') || l.msg.includes('history_end') ? '#69db7c' : l.msg.includes('emit') ? '#74c0fc' : '#8a8aaa' }}>
              <span style={{ color: '#4a4a6a' }}>{l.ts}</span>{' '}
              <span>{l.msg}</span>
            </div>
          ))}
          {ws.connected && ws.events.length > 0 && (
            <div style={{ fontSize: 11, lineHeight: 1.6, color: '#69db7c' }}>
              <span style={{ color: '#4a4a6a' }}>{'>'}</span>{' '}
              receiving live events... ({ws.events.length} total)
            </div>
          )}
        </div>
      </div>
      )}

      {error && <div style={{ padding: 12, background: 'rgba(255,61,61,0.1)', border: `1px solid ${C.danger}`, borderRadius: 6, color: C.danger, fontSize: 12, marginBottom: 16 }}>{error}</div>}

      {/* Score Header */}
      {selectedMatch && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 24px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: homeColor }}>{homeTlc || selectedMatch.homeTeam}</div>
            <div style={{ fontSize: 10, color: C.textMuted }}>{homeTeamName}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: C.white, letterSpacing: 2 }}>
              {showScore ? `${state.scoreA} : ${state.scoreB}` : ws.connected && !ws.historyLoaded ? '⏳' : '-:-'}
            </div>
            <div style={{ fontSize: 10, color: ws.connected ? C.danger : C.textMuted, fontWeight: 600 }}>
              {ws.connected && !ws.historyLoaded ? '⏳ Lade...' : ws.connected ? '🔴 LIVE' : '📅 Geplant'}
            </div>
            {state.currentQuarter && <div style={{ fontSize: 12, color: C.accent, fontWeight: 700 }}>{state.currentQuarter}</div>}
            {coverageStart && (
              <div style={{ fontSize: 9, color: C.warning, fontWeight: 600 }}>
                Live ab {coverageStart.quarter} {coverageStart.clock}
              </div>
            )}
            <div style={{ fontSize: 9, color: C.textDim }}>{formatDate(selectedMatch.scheduledAt)} · {formatTime(selectedMatch.scheduledAt)}{selectedMatch.competitionName ? ` · ${selectedMatch.competitionName}` : ''}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: guestColor }}>{guestTlc || selectedMatch.guestTeam}</div>
            <div style={{ fontSize: 10, color: C.textMuted }}>{guestTeamName}</div>
          </div>
        </div>
      )}

      {/* Score Flow Timeline — full width */}
      {selectedMatch && state.playEvents.length >= 2 && (
        <ScoreFlowTimeline
          events={state.playEvents}
          homeColor={homeColor}
          guestColor={guestColor}
          homeTlc={homeTlc || selectedMatch.homeTeam}
          guestTlc={guestTlc || selectedMatch.guestTeam}
        />
      )}

      {/* 2-column layout: Left Boxscore, Right Play-by-Play */}
      {selectedMatch && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 12, alignItems: 'start' }}>
          {/* Left column: Leaders + Boxscore tables */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            {statsReady ? (
              <>
                <InsightsPanel insights={insights} />
                <LeadersPanel playersA={state.playersA} playersB={state.playersB} tlcA={homeTlc || selectedMatch.homeTeam} tlcB={guestTlc || selectedMatch.guestTeam} homeColor={homeColor} guestColor={guestColor} />
                <TeamTable players={state.playersA} teamName={homeTeamName} tlc={homeTlc || selectedMatch.homeTeam} score={state.scoreA} accentColor={homeColor} />
                <TeamTable players={state.playersB} teamName={guestTeamName} tlc={guestTlc || selectedMatch.guestTeam} score={state.scoreB} accentColor={guestColor} />
              </>
            ) : ws.connected && ws.historyLoaded ? (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '24px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: C.warning, fontWeight: 600, marginBottom: 6 }}>⏳ Statistiken werden synchronisiert...</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>Boxscore und Team Leaders erscheinen, sobald die Spieler-Statistiken vollständig vorliegen.</div>
              </div>
            ) : ws.connected && !ws.historyLoaded ? (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '24px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: C.textMuted }}>⏳ Lade Spielhistorie...</div>
              </div>
            ) : (
              <>
                <InsightsPanel insights={insights} />
                <LeadersPanel playersA={[]} playersB={[]} tlcA={homeTlc || selectedMatch.homeTeam} tlcB={guestTlc || selectedMatch.guestTeam} homeColor={homeColor} guestColor={guestColor} />
                <TeamTable players={[]} teamName={homeTeamName} tlc={homeTlc || selectedMatch.homeTeam} score={0} accentColor={homeColor} />
                <TeamTable players={[]} teamName={guestTeamName} tlc={guestTlc || selectedMatch.guestTeam} score={0} accentColor={guestColor} />
              </>
            )}
          </div>

          {/* Right column: Play-by-Play Sidebar */}
          <div style={{ position: 'sticky', top: 12, height: 'calc(100vh - 100px)', minHeight: 0 }}>
            <PlayByPlayTimeline events={state.playEvents} homeColor={homeColor} guestColor={guestColor} historyIncomplete={ws.historyIncomplete} />
          </div>
        </div>
      )}
    </div>
  );
}
