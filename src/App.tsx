/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef, useCallback } from 'react';
import { 
  Settings2, 
  CircleDot, 
  Maximize2, 
  Layers,
  AlertCircle,
  Download,
  Printer,
  RefreshCcw,
  Search,
  X
} from 'lucide-react';

// --- Constants & Defaults ---
const DEFAULT_PCD = 100;
const DEFAULT_ROLLER_DIA = 10;

type Preset = {
  id: string;
  name: string;
  innerDia: number;
  outerDia: number;
  pcd: number;
  rollerDia: number;
  assemblyType: 'full' | 'half';
};

const DEFAULT_PRESETS: Preset[] = [
  { id: 'p1', name: 'KSF-14-080-UN-ULW', innerDia: 23, outerDia: 55, pcd: 44.5, rollerDia: 2.5, assemblyType: 'full' },
  { id: 'p2', name: 'YSX45-SHF', innerDia: 120, outerDia: 190, pcd: 154, rollerDia: 12, assemblyType: 'half' },
  { id: 'p3', name: 'YSX50-SHF', innerDia: 135, outerDia: 214, pcd: 170, rollerDia: 12, assemblyType: 'half' },
  { id: 'p4', name: 'YSX58-SHF', innerDia: 156, outerDia: 240, pcd: 195, rollerDia: 12, assemblyType: 'half' }
];

const getInitialPresets = (): Preset[] => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('crossRollerPresets');
    if (saved) return JSON.parse(saved);
  }
  return DEFAULT_PRESETS;
};

export default function App() {
  const initialPresets = useMemo(() => getInitialPresets(), []);
  const initialPreset = initialPresets.length > 0 ? initialPresets[0] : null;

  // --- States ---
  const [pcd, setPcd] = useState<number>(initialPreset ? initialPreset.pcd : DEFAULT_PCD);
  const [innerDia, setInnerDia] = useState<number>(initialPreset ? initialPreset.innerDia : 80);
  const [outerDia, setOuterDia] = useState<number>(initialPreset ? initialPreset.outerDia : 120);
  const [rollerDia, setRollerDia] = useState<number>(initialPreset ? initialPreset.rollerDia : DEFAULT_ROLLER_DIA);
  const [clearance, setClearance] = useState<number>(0.02); // Circumferential clearance per roller
  const [holeAllowance, setHoleAllowance] = useState<number>(0.1); // Allowance for assembly hole
  const [isCompacted, setIsCompacted] = useState<boolean>(false);
  const [assemblyType, setAssemblyType] = useState<'full' | 'half'>(initialPreset ? initialPreset.assemblyType : 'full');
  const [zSelectionMode, setZSelectionMode] = useState<'recommended' | 'max' | 'manual'>('recommended');
  const [manualZ, setManualZ] = useState<number>(0);

  // --- Factor Selection State ---
  const [isAutoCalculated, setIsAutoCalculated] = useState<boolean>(true);
  const [manualFcValue, setManualFcValue] = useState<number>(83.8);
  const [manualC0Factor, setManualC0Factor] = useState<number>(44);
  const [isAutoMoment, setIsAutoMoment] = useState<boolean>(true);
  const [manualMoment, setManualMoment] = useState<number>(26);

  // --- Print State ---
  const [showPrintWarning, setShowPrintWarning] = useState<boolean>(false);

  // --- Preset State ---
  const [presets, setPresets] = useState<Preset[]>(initialPresets);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(initialPreset ? initialPreset.id : '');

  React.useEffect(() => {
    localStorage.setItem('crossRollerPresets', JSON.stringify(presets));
  }, [presets]);

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedPresetId(id);
    if (id) {
      const preset = presets.find(p => p.id === id);
      if (preset) {
        setInnerDia(preset.innerDia);
        setOuterDia(preset.outerDia);
        setPcd(preset.pcd);
        setRollerDia(preset.rollerDia);
        setAssemblyType(preset.assemblyType);
      }
    }
  };

  const handleSavePreset = () => {
    const name = window.prompt('신규 규격명을 입력하세요:');
    if (name) {
      const newPreset: Preset = {
        id: Date.now().toString(),
        name,
        innerDia,
        outerDia,
        pcd,
        rollerDia,
        assemblyType
      };
      setPresets([...presets, newPreset]);
      setSelectedPresetId(newPreset.id);
    }
  };

  const handleUpdatePreset = () => {
    if (!selectedPresetId) return;
    setPresets(presets.map(p => p.id === selectedPresetId ? {
      ...p,
      innerDia,
      outerDia,
      pcd,
      rollerDia,
      assemblyType
    } : p));
    alert('규격이 업데이트 되었습니다.');
  };

  const handleDeletePreset = () => {
    if (!selectedPresetId) return;
    if (window.confirm('선택한 규격을 삭제하시겠습니까?')) {
      setPresets(presets.filter(p => p.id !== selectedPresetId));
      setSelectedPresetId('');
    }
  };

  // --- Zoom & Pan State ---
  const [zoom, setZoom] = useState<number>(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Handlers for ID/OD/PCD Sync ---
  const updateDiameters = (type: 'id' | 'od' | 'pcd', val: number) => {
    if (type === 'id') {
      setInnerDia(val);
    } else if (type === 'od') {
      setOuterDia(val);
    } else {
      setPcd(val);
    }
  };

  // --- Calculations ---
  const results = useMemo(() => {
    const circumference = Math.PI * pcd;
    const segmentWidth = rollerDia + holeAllowance;
    
    // Each roller occupies its diameter. 
    // For FULL assembly: We MUST leave space for 1 segment physical insertion.
    // For HALF assembly: Rollers can exist in the segment location during assembly.
    const zTheoretical = circumference / (rollerDia + clearance);
    
    let maxPossibleZ;
    if (assemblyType === 'full') {
      // In full assembly, Z * (rollerDia + clearance) must be <= circumference - segmentWidth
      maxPossibleZ = Math.floor((circumference - segmentWidth) / (rollerDia + clearance));
    } else {
      // In half assembly, Z * (rollerDia + clearance) must be <= circumference
      maxPossibleZ = Math.floor(zTheoretical);
    }
    
    // For cross roller bearings, an even number of rollers is strictly required for alternating directions
    const recommendedZ = maxPossibleZ % 2 === 0 ? maxPossibleZ : Math.max(0, maxPossibleZ - 1);

    // Determine target Z based on selection mode
    let targetZ = recommendedZ;
    if (zSelectionMode === 'max') targetZ = maxPossibleZ;
    if (zSelectionMode === 'manual') targetZ = manualZ || 0;

    const totalRollerLength = targetZ * (rollerDia + clearance);
    const residualGap = circumference - totalRollerLength;
    const actualGapPerRoller = targetZ > 0 ? (circumference / targetZ) - rollerDia : 0;
    
    const segmentAngle = 2 * Math.asin(segmentWidth / pcd);
    // Interference check for FULL: does the remaining gap accommodate the segment?
    // We increase sensitivity to ensure the count is restricted when it should be.
    const hasInterference = assemblyType === 'full' && (residualGap < segmentWidth - 0.01);

    // --- Load Ratings (ISO 281/76 approx for Roller Bearings) ---
    // For CROSS ROLLER BEARINGS, only half the rollers (Z/2) effectively carry load in one direction.
    const Z_eff = targetZ / 2;
    const Lw = rollerDia;
    const Dw = rollerDia;
    const alphaDeg = 45;
    const alphaRad = alphaDeg * (Math.PI / 180);
    const cosAlpha = Math.cos(alphaRad);
    const Dpw = pcd;

    // Static factor calculation based on gamma
    const gamma = (Dw * cosAlpha) / Dpw;
    const c0FactorCalc = 44 * (1 - gamma);

    // Dynamic fc table interpolation
    const fcTable = [
      [0.01, 52.1], [0.02, 60.8], [0.03, 66.5], [0.04, 70.7], [0.05, 74.1],
      [0.06, 76.9], [0.07, 79.2], [0.08, 81.2], [0.09, 82.8], [0.10, 84.2],
      [0.12, 86.4], [0.14, 87.7], [0.16, 88.5], [0.18, 88.8], [0.20, 88.7],
      [0.22, 88.2], [0.24, 87.5], [0.26, 86.4], [0.28, 85.2], [0.30, 83.8]
    ];
    let calculatedFc = 83.8;
    if (gamma <= fcTable[0][0]) {
      calculatedFc = fcTable[0][1];
    } else if (gamma >= fcTable[fcTable.length - 1][0]) {
      calculatedFc = fcTable[fcTable.length - 1][1];
    } else {
      for (let i = 0; i < fcTable.length - 1; i++) {
        if (gamma >= fcTable[i][0] && gamma <= fcTable[i+1][0]) {
          const g1 = fcTable[i][0], f1 = fcTable[i][1];
          const g2 = fcTable[i+1][0], f2 = fcTable[i+1][1];
          calculatedFc = f1 + ((gamma - g1) / (g2 - g1)) * (f2 - f1);
          break;
        }
      }
    }
    const bm = 1.1;

    const finalC0Factor = isAutoCalculated ? c0FactorCalc : manualC0Factor;
    const finalFc = isAutoCalculated ? calculatedFc : manualFcValue;

    // Static Load Rating (N)
    const c0 = finalC0Factor * Z_eff * Lw * Dw * cosAlpha;
    
    // Dynamic Load Rating (N)
    const c = bm * finalFc * Math.pow(Lw * cosAlpha, 7/9) * Math.pow(Z_eff, 3/4) * Math.pow(Dw, 29/27);

    // Final Moment Load Calculation
    const autoMoment = (c0 * Dpw / 2) / 1000;
    const finalMoment = isAutoMoment ? autoMoment : manualMoment;

    // Moment Rigidity (N-m/rad)
    const M_Nmm = finalMoment * 1000;
    const sinAlpha = Math.sin(alphaRad);
    const Q_max = (4 * M_Nmm) / (targetZ * Dpw * sinAlpha);
    const delta = 3.84 * Math.pow(10, -5) * (Math.pow(Q_max, 0.9) / Math.pow(Lw, 0.8));
    const theta = (delta * sinAlpha) / (Dpw / 2);
    const Km = finalMoment / theta;

    return {
      totalRollers: targetZ,
      recommendedZ,
      theoreticalMax: maxPossibleZ,
      isEven: true,
      segmentLength: segmentWidth,
      actualGap: actualGapPerRoller.toFixed(4),
      circumference: circumference.toFixed(2),
      totalRollerLength: totalRollerLength.toFixed(2),
      residualGap: residualGap.toFixed(3),
      c: (c / 1000).toFixed(2),
      c0: (c0 / 1000).toFixed(2),
      details: {
        Lw,
        Dw,
        alpha: alphaDeg,
        cosAlpha: cosAlpha.toFixed(4),
        fc: finalFc.toFixed(2),
        gamma: gamma.toFixed(4),
        bm,
        Z: targetZ,
        Z_eff,
        c0Factor: finalC0Factor.toFixed(2),
        c0_calc: `${finalC0Factor.toFixed(2)} × (${targetZ}/2) × ${Lw} × ${Dw} × ${cosAlpha.toFixed(4)}`,
        c_calc: `${bm} × ${finalFc.toFixed(2)} × (${Lw} × ${cosAlpha.toFixed(4)})^{7/9} × (${targetZ}/2)^{3/4} × ${Dw}^{29/27}`,
        Qmax: Q_max,
        delta: delta,
        theta: theta,
        Km: Km,
        Dpw: Dpw,
        finalMoment: finalMoment,
        c0_N: c0,
        isAutoMoment: isAutoMoment,
        manualMoment: manualMoment
      },
      segmentAngle,
      hasInterference,
      Km,
      finalMoment
    };
  }, [pcd, rollerDia, clearance, holeAllowance, assemblyType, zSelectionMode, manualZ, isAutoCalculated, manualFcValue, manualC0Factor, isAutoMoment, manualMoment]);

  // --- View Handling ---
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(prev => Math.min(Math.max(prev * delta, 0.5), 10));
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMousePos.current.x;
    const dy = e.clientY - lastMousePos.current.y;
    setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const resetView = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  // --- Render Helpers ---
  const renderRollers = () => {
    const rollers = [];
    if (results.totalRollers <= 0) return null;
    
    const angleStepUniform = (2 * Math.PI) / results.totalRollers;
    // Chord length to angle: theta = 2 * arcsin(d / (2*r)) where r = pcd/2
    const rollerArcAngle = 2 * Math.asin(rollerDia / pcd);
    const angleStepCompacted = 2 * Math.asin((rollerDia + clearance) / pcd);
    
    // We want the block of rollers to be centered at the bottom (PI/2),
    // which leaves the residual gap centered at the top (-PI/2) where the segment is.
    const totalOccupiedArc = (results.totalRollers - 1) * angleStepCompacted;
    const startAngleCompacted = (Math.PI / 2) - (totalOccupiedArc / 2);

    for (let i = 0; i < results.totalRollers; i++) {
      let angle;
      if (isCompacted) {
        angle = startAngleCompacted + (i * angleStepCompacted);
      } else {
        angle = i * angleStepUniform;
      }
      
      const x = (pcd / 2) * Math.cos(angle);
      const y = (pcd / 2) * Math.sin(angle);
      
      const isAlt = i % 2 === 0;
      
       rollers.push(
        <g key={i}>
          <circle 
            cx={x} 
            cy={y} 
            r={rollerDia / 2} 
            fill={isAlt ? "#1d4ed8" : "#3b82f6"}
            fillOpacity={0.4}
            stroke="#1d4ed8"
            strokeWidth={0.02}
          />
          <line 
            x1={x - (rollerDia/4)} 
            y1={isAlt ? y - (rollerDia/4) : y + (rollerDia/4)}
            x2={x + (rollerDia/4)} 
            y2={isAlt ? y + (rollerDia/4) : y - (rollerDia/4)}
            stroke="#94a3b8"
            strokeWidth={0.03}
            strokeLinecap="round"
          />
        </g>
      );
    }
    return rollers;
  };

  return (
    <div className="w-full h-screen bg-[#0f172a] text-slate-200 font-sans flex flex-col overflow-hidden print:h-auto print:overflow-visible print:bg-[#0f172a] print:text-slate-200">
      {/* Top Header */}
      <header className="h-16 border-b border-slate-700 flex items-center justify-between px-8 bg-[#1e293b] shrink-0 print:hidden">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-500 rounded flex items-center justify-center print:border print:border-black">
            <CircleDot className="w-5 h-5 text-white pr-print" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white print:text-black">CRB-Designer: Cross-Roller Precision Tool</h1>
        </div>
        <div className="hidden sm:block text-xs font-mono text-slate-400 bg-slate-900 px-3 py-1 rounded border border-slate-700 tracking-tighter uppercase tracking-widest print:hidden">
          ENGINEERING TOOL // SYSTEM ACTIVE
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 grid grid-cols-12 overflow-hidden print:block print:overflow-visible print:h-auto">
        {/* Left Sidebar: Parameters */}
        <aside className="col-span-12 lg:col-span-4 border-r border-slate-700 p-6 flex flex-col gap-6 bg-[#0f172a] overflow-y-auto print:block print:overflow-visible">
          <div className="space-y-6">
            <h2 className="text-xs font-semibold text-blue-400 uppercase tracking-widest border-b border-blue-500/30 pb-2">
              Input Parameters
            </h2>
            
            {/* Preset Selection */}
            <div className="space-y-3 pb-4 border-b border-slate-800">
              <label className="block text-[10px] text-slate-500 uppercase font-bold tracking-widest">기존 설계 규격 (Presets)</label>
              <div className="flex gap-2">
                <select 
                  className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-2 text-white font-sans text-sm focus:border-blue-500 outline-none truncate"
                  value={selectedPresetId}
                  onChange={handlePresetChange}
                >
                  <option value="">-- 신규/자율 규격 --</option>
                  {presets.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 text-xs font-medium">
                <button onClick={handleSavePreset} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-1.5 rounded transition shadow-sm">추가/저장</button>
                <button onClick={handleUpdatePreset} disabled={!selectedPresetId} className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 py-1.5 rounded transition shadow-sm">수정</button>
                <button onClick={handleDeletePreset} disabled={!selectedPresetId} className="flex-1 bg-red-900/80 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-red-100 py-1.5 rounded transition shadow-sm">삭제</button>
              </div>
            </div>

            {/* ID / OD Inputs */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-[10px] text-slate-500 uppercase font-bold tracking-widest">Inner Dia (d)</label>
                <input 
                  type="number" 
                  value={innerDia} 
                  onChange={(e) => updateDiameters('id', Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white font-mono text-sm focus:border-blue-500 outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-[10px] text-slate-500 uppercase font-bold tracking-widest">Outer Dia (D)</label>
                <input 
                  type="number" 
                  value={outerDia} 
                  onChange={(e) => updateDiameters('od', Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white font-mono text-sm focus:border-blue-500 outline-none"
                />
              </div>
            </div>

            {/* PCD Input */}
            <div className="space-y-3">
              <div className="flex justify-between items-end text-[11px] uppercase tracking-wider font-bold text-slate-500">
                <label>Pitch Circle Diameter (PCD)</label>
                <span className="text-blue-400 font-mono tracking-tighter">Calc: {( (innerDia + outerDia)/2 ).toFixed(2)} mm</span>
              </div>
              <div className="flex items-center gap-2">
                <input 
                  type="number" 
                  value={pcd} 
                  onChange={(e) => updateDiameters('pcd', Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white font-mono text-sm focus:border-blue-500 outline-none transition-colors"
                />
                <span className="text-xs text-slate-500 font-mono">[MM]</span>
              </div>
            </div>

            {/* Roller Dia Input */}
            <div className="space-y-3">
              <div className="flex justify-between items-end text-[11px] uppercase tracking-wider font-bold text-slate-500">
                <label>Roller Diameter (d<sub>w</sub>)</label>
                <span className="text-blue-400 font-mono">{rollerDia} mm</span>
              </div>
              <input 
                type="range"
                min="1"
                max="100"
                step="0.1"
                value={rollerDia}
                onChange={(e) => setRollerDia(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
              <div className="flex items-center gap-2">
                <input 
                  type="number" 
                  value={rollerDia} 
                  onChange={(e) => setRollerDia(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white font-mono text-sm focus:border-blue-500 outline-none transition-colors"
                />
                <span className="text-xs text-slate-500 font-mono">[MM]</span>
              </div>
            </div>

            {/* Load Capacity Factors */}
            <div className="space-y-4 pt-4 border-t border-slate-800">
              <h3 className="text-[10px] text-slate-500 uppercase font-black tracking-widest flex justify-between items-center">
                <span>Load Capacity Factors</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-3 h-3 rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-950"
                    checked={isAutoCalculated}
                    onChange={(e) => setIsAutoCalculated(e.target.checked)}
                  />
                  <span className="text-[8px] bg-blue-900/40 text-blue-400 px-2 rounded-full py-0.5 whitespace-nowrap">Auto-Calculated</span>
                </label>
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-[9px] text-slate-500 uppercase font-bold tracking-wider break-normal">γ (Dw·cos(α)/Dpw)</label>
                  <div className="w-full bg-slate-950/50 border border-slate-800 rounded px-2 py-1.5 text-slate-400 font-mono text-xs tracking-tight">
                    {results.details.gamma}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-[9px] text-slate-500 uppercase font-bold tracking-wider">bm Factor</label>
                  <div className="w-full bg-slate-950/50 border border-slate-800 rounded px-2 py-1.5 text-slate-400 font-mono text-xs tracking-tight">
                    {results.details.bm}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-[9px] text-slate-500 uppercase font-bold tracking-wider">Dynamic (fc)</label>
                  {isAutoCalculated ? (
                    <div className="w-full bg-slate-950/50 border border-slate-800 rounded px-2 py-1.5 text-blue-400 font-mono text-xs font-bold tracking-tight">
                      {results.details.fc}
                    </div>
                  ) : (
                    <input 
                      type="number" 
                      value={manualFcValue} 
                      onChange={(e) => setManualFcValue(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white font-mono text-xs focus:border-blue-500 outline-none"
                      step="0.1"
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <label className="block text-[9px] text-slate-500 uppercase font-bold tracking-wider">Static Factor (f₀)</label>
                  {isAutoCalculated ? (
                    <div className="w-full bg-slate-950/50 border border-slate-800 rounded px-2 py-1.5 text-blue-400 font-mono text-xs font-bold tracking-tight">
                      {results.details.c0Factor}
                    </div>
                  ) : (
                    <input 
                      type="number" 
                      value={manualC0Factor} 
                      onChange={(e) => setManualC0Factor(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white font-mono text-xs focus:border-blue-500 outline-none"
                      step="0.1"
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Rigidity Parameters */}
            <div className="space-y-4 pt-4 border-t border-slate-800">
              <h3 className="text-[10px] text-slate-500 uppercase font-black tracking-widest flex justify-between items-center">
                <span>Rigidity Parameters</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-3 h-3 rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-950"
                    checked={isAutoMoment}
                    onChange={(e) => setIsAutoMoment(e.target.checked)}
                  />
                  <span className="text-[8px] bg-blue-900/40 text-blue-400 px-2 rounded-full py-0.5 whitespace-nowrap">Auto (M₀=C₀·Dpw/2)</span>
                </label>
              </h3>
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <label className="block text-[9px] text-slate-500 uppercase font-bold tracking-wider">Test Moment Load (M) [N·m]</label>
                  {isAutoMoment ? (
                    <div className="w-full bg-slate-950/50 border border-slate-800 rounded px-2 py-1.5 text-blue-400 font-mono text-xs font-bold tracking-tight">
                      {results.finalMoment.toFixed(1)}
                    </div>
                  ) : (
                    <input
                      type="number"
                      value={manualMoment}
                      onChange={(e) => setManualMoment(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-white font-mono text-xs focus:border-blue-500 outline-none"
                      step="1"
                      min="1"
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Load Ratings Result Panel */}
            <div className="space-y-4 pt-4 border-t border-slate-800">
              <h3 className="text-[10px] text-blue-500 uppercase font-black tracking-[0.2em]">Load Capacity Analysis</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-900/80 p-3 rounded border border-slate-800">
                  <div className="text-[9px] text-slate-500 uppercase font-bold mb-1">Dynamic (C)</div>
                  <div className="text-lg font-mono text-white">{results.c} <span className="text-[10px] text-slate-600">kN</span></div>
                </div>
                <div className="bg-slate-900/80 p-3 rounded border border-slate-800">
                  <div className="text-[9px] text-slate-500 uppercase font-bold mb-1">Static (C0)</div>
                  <div className="text-lg font-mono text-white">{results.c0} <span className="text-[10px] text-slate-600">kN</span></div>
                </div>
                <div className="bg-slate-900/80 p-3 rounded border border-slate-800 col-span-2">
                  <div className="text-[9px] text-slate-500 uppercase font-bold mb-1">Moment Rigidity (Km)</div>
                  <div className="text-lg font-mono text-white">{(results.Km / 10000).toFixed(1)}<span className="text-[10px] text-slate-600 ml-1">×10⁴ Nm/rad</span></div>
                </div>
              </div>
            </div>

            {/* Roller Quantity Selection */}
            <div className="space-y-4 pt-4 border-t border-slate-800">
              <label className="block text-[10px] text-slate-500 uppercase font-black tracking-widest">Roller Quantity Selection (Z)</label>
              
              <div className="flex flex-col gap-2">
                <button 
                  onClick={() => setZSelectionMode('recommended')}
                  className={`flex justify-between items-center px-3 py-2 border rounded text-[10px] font-bold uppercase transition-all ${
                    zSelectionMode === 'recommended' 
                    ? "bg-blue-600 border-blue-400 text-white shadow-md shadow-blue-900/40" 
                    : "bg-slate-900 border-slate-700 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  <span>Recommended (Even)</span>
                  <span className="font-mono">{results.recommendedZ}</span>
                </button>
                
                <button 
                  onClick={() => setZSelectionMode('max')}
                  className={`flex justify-between items-center px-3 py-2 border rounded text-[10px] font-bold uppercase transition-all ${
                    zSelectionMode === 'max' 
                    ? "bg-indigo-600 border-indigo-400 text-white shadow-md shadow-indigo-900/40" 
                    : "bg-slate-900 border-slate-700 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  <span>Theoretical Max</span>
                  <span className="font-mono">{results.theoreticalMax}</span>
                </button>
                
                <div className={`p-2 border rounded space-y-2 transition-all ${
                  zSelectionMode === 'manual' 
                  ? "bg-slate-800 border-slate-600" 
                  : "bg-slate-900/30 border-slate-800/50 opacity-60"
                }`}>
                  <button 
                    onClick={() => {
                      if (zSelectionMode !== 'manual') {
                        setManualZ(results.totalRollers);
                        setZSelectionMode('manual');
                      }
                    }}
                    className={`w-full flex justify-between items-center text-[10px] font-bold uppercase ${
                      zSelectionMode === 'manual' ? "text-slate-200" : "text-slate-600"
                    }`}
                  >
                    <span>Custom Quantity</span>
                    <span className="font-mono">{manualZ || results.totalRollers}</span>
                  </button>
                  
                  {zSelectionMode === 'manual' && (
                    <div className="pt-1">
                      <input 
                        type="range"
                        min="2"
                        max={results.theoreticalMax + 10}
                        step="1"
                        value={manualZ || results.totalRollers}
                        onChange={(e) => setManualZ(Number(e.target.value))}
                        className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />
                      <input 
                        type="number" 
                        value={manualZ || results.totalRollers} 
                        onChange={(e) => setManualZ(Number(e.target.value))}
                        className="mt-2 w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white font-mono text-xs outline-none"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Assembly Type Selection */}
            <div className="space-y-3 pt-4 border-t border-slate-800">
              <label className="block text-[10px] text-slate-500 uppercase font-black tracking-widest">Assembly Type</label>
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => setAssemblyType('full')}
                  className={`px-3 py-2 border rounded text-[10px] font-bold uppercase transition-all ${
                    assemblyType === 'full' 
                    ? "bg-indigo-600 border-indigo-400 text-white" 
                    : "bg-slate-900 border-slate-700 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Full Segment (전체)
                </button>
                <button 
                  onClick={() => setAssemblyType('half')}
                  className={`px-3 py-2 border rounded text-[10px] font-bold uppercase transition-all ${
                    assemblyType === 'half' 
                    ? "bg-indigo-600 border-indigo-400 text-white" 
                    : "bg-slate-900 border-slate-700 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Half Segment (절반)
                </button>
              </div>
              <p className="text-[9px] text-slate-600 leading-relaxed">
                {assemblyType === 'full' 
                  ? "* 전체 조립: 삽입 시 롤러와의 간섭을 피하기 위한 여유 공간이 필요합니다."
                  : "* 절반 조립: 롤러가 조립 위치에 있어도 조립이 가능합니다."}
              </p>
            </div>

            {/* Advanced Clearances */}
            <div className="space-y-4 pt-4 border-t border-slate-800">
               <div className="space-y-2">
                <label className="block text-[10px] text-slate-500 uppercase font-bold tracking-widest">Clearance per roller (C<sub>t</sub>)</label>
                <input 
                  type="number" 
                  step="0.001"
                  value={clearance} 
                  onChange={(e) => setClearance(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-slate-300 font-mono text-xs focus:border-blue-500 outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-[10px] text-slate-500 uppercase font-bold tracking-widest">Hole Tolerance Allowance</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={holeAllowance} 
                  onChange={(e) => setHoleAllowance(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-slate-300 font-mono text-xs focus:border-blue-500 outline-none"
                />
              </div>
            </div>
          </div>

          <div className="mt-auto p-4 bg-slate-800/50 rounded border border-slate-700 flex gap-3 print:hidden">
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
            <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
              <span className="text-amber-500 font-bold uppercase tracking-wider">Engineering Note:</span><br />
              Standard cross-roller assembly requires an even quantity (Z) of rollers to maintain raceway symmetry. Output is optimized for full complement.
            </p>
          </div>
        </aside>

        {/* Right Side: Results & Visualization */}
        <section className="col-span-12 lg:col-span-8 p-6 lg:p-10 flex flex-col gap-8 bg-[#020617] overflow-y-auto print:block print:overflow-visible print:h-auto">
          {/* Main Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="col-span-1 md:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
                <div className="bg-slate-900/50 p-3 border border-slate-800 rounded">
                  <div className="text-[9px] text-slate-500 uppercase font-bold mb-1">PCD Circumference</div>
                  <div className="text-lg font-mono text-white">{results.circumference} <span className="text-[10px]">mm</span></div>
                </div>
                <div className="bg-slate-900/50 p-3 border border-slate-800 rounded">
                  <div className="text-[9px] text-slate-500 uppercase font-bold mb-1">Total Roller Arc</div>
                  <div className="text-lg font-mono text-blue-400">{results.totalRollerLength} <span className="text-[10px]">mm</span></div>
                </div>
                <div className="bg-slate-900/50 p-3 border border-slate-800 rounded">
                  <div className="text-[9px] text-slate-500 uppercase font-bold mb-1">Residual Play</div>
                  <div className="text-lg font-mono text-emerald-400">{results.residualGap} <span className="text-[10px]">mm</span></div>
                </div>
                <div className="bg-slate-900/50 p-3 border border-slate-800 rounded">
                  <div className="text-[9px] text-slate-500 uppercase font-bold mb-1">Gap %</div>
                  <div className="text-lg font-mono text-slate-400">{( (Number(results.residualGap) / Number(results.circumference)) * 100).toFixed(2)} %</div>
                </div>
                {results.hasInterference && (
                  <div className="col-span-2 md:col-span-4 bg-red-500/10 border border-red-500/50 p-3 rounded flex items-center gap-3 animate-pulse">
                    <AlertCircle className="text-red-500 w-5 h-5 flex-shrink-0" />
                    <div className="text-xs text-red-200">
                      <span className="font-bold block uppercase tracking-wider">조립 간섭 감지 (Assembly Interference)</span>
                      잔류 간격이 세그먼트 길이보다 작습니다. 롤러 수량을 줄이거나 크기를 조정하십시오.
                    </div>
                  </div>
                )}
              </div>

            <div className="bg-slate-900 p-5 border border-slate-800 rounded shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-2 opacity-10 text-blue-400 group-hover:opacity-20 transition-opacity"><Layers className="w-12 h-12" /></div>
              <div className="text-[10px] text-slate-500 uppercase font-bold mb-2 tracking-widest">Roller Quantity (Z)</div>
              <div className="text-4xl font-mono text-white leading-none tracking-tighter">
                {results.totalRollers}
                <span className="text-sm ml-2 text-slate-500">/ {results.theoreticalMax}</span>
              </div>
              <div className="text-[10px] text-blue-400 mt-4 font-bold uppercase tracking-tight">
                {assemblyType === 'full' ? "Restricted for Assembly" : "Full Circular Capacity"}
              </div>
            </div>
            
            <div className="bg-slate-900 p-5 border border-slate-800 rounded shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-2 opacity-10 text-indigo-400 group-hover:opacity-20 transition-opacity"><Maximize2 className="w-12 h-12" /></div>
              <div className="text-[10px] text-slate-500 uppercase font-bold mb-2 tracking-widest">Assy Segment (L)</div>
              <div className="text-4xl font-mono text-white leading-none tracking-tighter">{results.segmentLength.toFixed(2)}</div>
              <div className="text-[10px] text-indigo-400 mt-4 font-bold uppercase tracking-tight">Inner Race Cut-out</div>
            </div>

            <div className="bg-slate-900 p-5 border border-slate-800 rounded shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-2 opacity-10 text-emerald-400 group-hover:opacity-20 transition-opacity"><CircleDot className="w-12 h-12" /></div>
              <div className="text-[10px] text-slate-500 uppercase font-bold mb-2 tracking-widest">Pitch Arc Gap</div>
              <div className="text-4xl font-mono text-white leading-none tracking-tighter">{results.actualGap}</div>
              <div className="text-[10px] text-emerald-500 mt-4 font-bold uppercase tracking-tight">Total Circum: {results.circumference}mm</div>
            </div>
          </div>

          {/* Load Rating Breakdown Section */}
          <div className="bg-slate-900/40 border border-slate-800 rounded p-6 space-y-6">
            <div>
              <h3 className="text-xs font-bold text-blue-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                <Settings2 className="w-3 h-3" /> 부하 정격 계산 상세 (Load Rating Breakdown)
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Static Load Rating C0 */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">정정격하중 (C₀)</span>
                    <span className="text-sm font-mono text-white font-bold">{results.c0} kN</span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded font-mono text-[11px] text-slate-300 leading-relaxed h-full">
                    <div className="text-blue-400 mb-1">Formula:</div>
                    <div>C₀ = f₀ × (Z/2) × Lw × Dw × cos(α)</div>
                    <div className="text-[10px] text-slate-500 my-1">where f₀ = 44 × (1 - Dw·cos(α)/Dpw)</div>
                    <div className="text-slate-600 my-1">Process:</div>
                    <div className="text-slate-400">
                      C₀ = {results.details.c0Factor} × ({results.details.Z}/2) × {results.details.Lw} × {results.details.Dw} × {results.details.cosAlpha}<br />
                      C₀ = {(Number(results.c0) * 1000).toFixed(1)} N
                    </div>
                  </div>
                </div>

                {/* Dynamic Load Rating C */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">동정격하중 (C)</span>
                    <span className="text-sm font-mono text-white font-bold">{results.c} kN</span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded font-mono text-[11px] text-slate-300 leading-relaxed h-full">
                    <div className="text-blue-400 mb-1">Formula:</div>
                    <div className="text-[10px]">C = bm × fc × (Lw·cos α)⁷/⁹ × (Z/2)³/⁴ × Dw²⁹/²⁷</div>
                    <div className="text-slate-600 my-1">Process:</div>
                    <div className="text-[10px] text-slate-400 overflow-x-auto whitespace-nowrap scrollbar-hide pb-1 mt-6">
                      C = {results.details.bm} × {results.details.fc} × ({results.details.Lw} × {results.details.cosAlpha})⁷/⁹ × ({results.details.Z}/2)³/⁴ × {results.details.Dw}²⁹/²⁷<br />
                      C = {(Number(results.c) * 1000).toFixed(1)} N
                    </div>
                  </div>
                </div>

                {/* Moment Load M */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">모멘트 하중 (M)</span>
                    <span className="text-sm font-mono text-white font-bold">{results.finalMoment.toFixed(1)} N·m</span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded font-mono text-[11px] text-slate-300 leading-relaxed h-full">
                    <div className="text-blue-400 mb-1">Formula:</div>
                    <div className="text-[10px]">
                      {results.details.isAutoMoment ? (
                        <>M₀ = (C₀ × Dpw / 2) / 1000 (N·m)</>
                      ) : (
                        <>M = 사용자 수동 설정 부하 (N·m)</>
                      )}
                    </div>
                    <div className="text-slate-600 my-1">Process:</div>
                    <div className="text-[10px] text-slate-400 overflow-x-auto whitespace-nowrap scrollbar-hide pb-1">
                      {results.details.isAutoMoment ? (
                        <>
                          C₀ = {(Number(results.c0) * 1000).toFixed(1)} N<br />
                          Dpw = {results.details.Dpw.toFixed(1)} mm<br />
                          M₀ = ({(Number(results.c0) * 1000).toFixed(1)} × {results.details.Dpw.toFixed(1)} / 2) / 1000<br />
                          M₀ = {results.finalMoment.toFixed(1)} N·m
                        </>
                      ) : (
                        <>
                          수동 편집이 활성화되어<br />
                          지정된 모멘트 하중을 사용합니다.<br />
                          M = {results.details.manualMoment.toFixed(1)} N·m
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Moment Rigidity Km */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">모멘트 강성 (Km)</span>
                    <span className="text-sm font-mono text-white font-bold">{(results.Km / 10000).toFixed(1)}×10⁴ Nm/rad</span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded font-mono text-[11px] text-slate-300 leading-relaxed h-full">
                    <div className="text-blue-400 mb-1">Formula (Palmgren):</div>
                    <div className="text-[10px]">Km = M / (δ·sinα / (Dpw/2))</div>
                    <div className="text-[10px] text-slate-500 mb-1">Qmax = 4M / (Z·Dpw·sinα), δ = 3.84e-5·Qmax⁰.⁹ / Lw⁰.⁸</div>
                    <div className="text-slate-600 my-1">Process:</div>
                    <div className="text-[10px] text-slate-400 overflow-x-auto whitespace-nowrap scrollbar-hide pb-1">
                      δ = 3.84e-5 · {results.details.Qmax.toFixed(1)}⁰.⁹ / {results.details.Lw}⁰.⁸ = {results.details.delta.toFixed(5)}<br />
                      θ = {results.details.delta.toFixed(5)}·sin45° / ({results.details.Dpw}/2) = {results.details.theta.toExponential(2)}<br />
                      Km = {results.details.finalMoment.toFixed(1)} / {results.details.theta.toExponential(2)} = {results.details.Km.toFixed(0)} N·m/rad
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-800/50 grid grid-cols-2 lg:grid-cols-8 gap-y-2 gap-x-4">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-slate-500">Z (총수량):</span>
                  <span className="text-[10px] font-mono text-slate-300">{results.details.Z}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-slate-500">Ze (유효수량):</span>
                  <span className="text-[10px] font-mono text-blue-400">{results.details.Z_eff}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-slate-500">Lw (유효길이):</span>
                  <span className="text-[10px] font-mono text-slate-300">{results.details.Lw} mm</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-slate-500">Dw (직경):</span>
                  <span className="text-[10px] font-mono text-slate-300">{results.details.Dw} mm</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-slate-500">α (접촉각):</span>
                  <span className="text-[10px] font-mono text-slate-300">{results.details.alpha}°</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-slate-500">fc (동특성):</span>
                  <span className="text-[10px] font-mono text-slate-300">{results.details.fc}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-slate-500">f₀ (정특성):</span>
                  <span className="text-[10px] font-mono text-slate-300">{results.details.c0Factor}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-slate-500">M (모멘트):</span>
                  <span className="text-[10px] font-mono text-slate-300">{results.details.finalMoment.toFixed(1)} N-m</span>
                </div>
              </div>
            </div>
          </div>

          {/* Schematic Area */}
          <div 
            ref={containerRef}
            className="flex-1 bg-slate-950 border border-slate-800 rounded shadow-inner relative overflow-hidden flex items-center justify-center min-h-[400px] cursor-grab active:cursor-grabbing"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <div className="absolute top-6 left-6 flex flex-col font-mono z-10 pointer-events-none">
              <span className="text-[10px] text-slate-600 font-bold uppercase tracking-widest leading-none">Drafting View_AX-01</span>
              <span className="text-[9px] text-slate-800">ISO-VIEW // CALC-SCALE 1:1</span>
            </div>

            {/* Interaction Tools */}
            <div className="absolute top-6 right-6 flex flex-col items-end gap-2 z-10">
              <div className="flex gap-2">
                <button 
                  onClick={() => setIsCompacted(!isCompacted)}
                  className={`px-3 py-2 border rounded transition-colors flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest ${
                    isCompacted 
                    ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20" 
                    : "bg-slate-900/80 border-slate-700 text-slate-400 hover:text-white"
                  }`}
                >
                  <Layers className="w-3 h-3" /> {isCompacted ? "Compacted View" : "Uniform View"}
                </button>
                <button 
                  onClick={resetView}
                  className="px-3 py-2 bg-slate-900/80 border border-slate-700 rounded text-slate-400 hover:text-white transition-colors flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest"
                >
                  <RefreshCcw className="w-3 h-3" /> Reset
                </button>
              </div>
              <div className="px-3 py-2 bg-slate-900/80 border border-slate-700 rounded text-blue-400 text-[9px] font-mono flex items-center gap-2">
                <Search className="w-3 h-3" /> {Math.round(zoom * 100)}%
              </div>
            </div>

            <div className="absolute bottom-6 left-6 text-[9px] font-mono text-slate-700 bg-slate-950/50 px-2 py-1 rounded">
              SCROLL TO ZOOM // DRAG TO PAN
            </div>
            
            <div 
              className="w-full h-full max-w-[550px] aspect-square p-4 transition-transform duration-75 pointer-events-none"
              style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
            >
               {/* 
                 Dynamic ViewBox:
                 Instead of a fixed 120x120 viewBox, we now use a boundary based on outerDia.
                 This ensures the SVG's internal clipping rect always contains the whole bearing.
               */}
               <svg 
                  viewBox={`${-(Math.max(outerDia + rollerDia * 2.5, 120)) / 2} ${-(Math.max(outerDia + rollerDia * 2.5, 120)) / 2} ${Math.max(outerDia + rollerDia * 2.5, 120)} ${Math.max(outerDia + rollerDia * 2.5, 120)}`}
                  className="w-full h-full drop-shadow-[0_0_30px_rgba(30,58,138,0.1)]"
                  style={{ transform: `scale(${zoom})` }}
                >
                  {/* Raceway Outlines */}
                  <circle cx="0" cy="0" r={outerDia / 2} fill="none" stroke="#1e293b" strokeWidth={Math.max(0.2, outerDia / 100)} />
                  <circle cx="0" cy="0" r={innerDia / 2} fill="none" stroke="#1e293b" strokeWidth={Math.max(0.2, outerDia / 100)} />

                  {/* PCD Construction Line */}
                  <circle 
                    cx="0" cy="0" r={pcd / 2} 
                    fill="none" 
                    stroke="#334155" 
                    strokeWidth={Math.max(0.1, outerDia / 500)} 
                    strokeDasharray={`${Math.max(0.5, outerDia/100)},${Math.max(0.5, outerDia/100)}`}
                  />
                  
                  {/* Rollers Rendering */}
                  <g>{renderRollers()}</g>

                  {/* Inner Race Assembly Segment (Matching User Image) */}
                  <g>
                    {/* The Segment Cutout Representation - Width based on segmentLength */}
                    <path 
                      d={`
                        M ${-(results.segmentLength / 2)} ${-(pcd/2 - rollerDia * 0.3)}
                        L ${-(results.segmentLength / 2 * 1.1)} ${-(pcd/2 - (assemblyType === 'half' ? rollerDia * 0.75 : rollerDia * 1.2))}
                        A ${(pcd - (assemblyType === 'half' ? rollerDia * 1.5 : rollerDia * 2.4))/2} ${(pcd - (assemblyType === 'half' ? rollerDia * 1.5 : rollerDia * 2.4))/2} 0 0 1 ${(results.segmentLength / 2 * 1.1)} ${-(pcd/2 - (assemblyType === 'half' ? rollerDia * 0.75 : rollerDia * 1.2))}
                        L ${(results.segmentLength / 2)} ${-(pcd/2 - rollerDia * 0.3)}
                        A ${pcd/2} ${pcd/2} 0 0 0 ${-(results.segmentLength / 2)} ${-(pcd/2 - rollerDia * 0.3)}
                      `}
                      fill="#0f172a"
                      stroke="#ef4444"
                      strokeWidth={0.03}
                      strokeDasharray={assemblyType === 'half' ? "0.2,0.1" : "none"}
                    />
                    {/* Fixed Screw Hole */}
                    <circle 
                      cx="0" cy={-(pcd/2 - (assemblyType === 'half' ? rollerDia * 0.4 : rollerDia * 0.75))} 
                      r={rollerDia / 8} 
                      fill="none" 
                      stroke="#ef4444" 
                      strokeWidth={0.02}
                    />
                    <text 
                      x={results.segmentLength / 2 + 2} 
                      y={-(pcd / 2 - rollerDia * 0.5)} 
                      fill="#ef4444" 
                      fontSize={Math.max(2.5, outerDia / 45)} 
                      fontFamily="monospace" 
                      fontWeight="bold"
                    >
                      SEGMENT (L={results.segmentLength.toFixed(1)}) [{assemblyType.toUpperCase()}]
                    </text>
                  </g>

                  {/* Center Markings */}
                  <line x1="-5" y1="0" x2="5" y2="0" stroke="#1e293b" strokeWidth="0.1" />
                  <line x1="0" y1="-5" x2="0" y2="5" stroke="#1e293b" strokeWidth="0.1" />
                </svg>
            </div>

            <div className="absolute bottom-8 right-8 text-right font-mono pointer-events-none">
              <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-1">Standard Reference</div>
              <div className="text-xs text-slate-400">JIS B 1512 / ISO 286</div>
            </div>
          </div>

          {/* Action Footer for Right Section */}
          <div className="flex flex-col sm:flex-row gap-4 shrink-0 print:hidden">
             <div className="flex-1 bg-slate-900/50 border border-slate-800 p-4 rounded flex items-center justify-between">
                <div>
                   <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Total Gap Acc.</div>
                   <div className="text-xl font-mono text-emerald-400">{(Number(results.actualGap) * results.totalRollers).toFixed(4)} <span className="text-[10px] uppercase text-slate-600">mm</span></div>
                </div>
                <div className="text-right">
                   <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Status</div>
                   <div className="text-xs font-mono text-white flex items-center gap-2">
                     VALIDATED <div className="w-1.5 h-1.5 bg-blue-500 rounded-full shadow-[0_0_5px_rgba(59,130,246,0.5)]"></div>
                   </div>
                </div>
             </div>
             <div className="flex gap-3 h-full">
               <button 
                onClick={() => {
                  let isIframe = false;
                  try {
                    isIframe = window.self !== window.top;
                  } catch (e) {
                    isIframe = true;
                  }
                  if (isIframe) {
                    setShowPrintWarning(true);
                  } else {
                    window.print();
                  }
                }} 
                className="px-6 py-4 border border-slate-700 hover:bg-slate-800 text-slate-300 rounded flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest transition-colors whitespace-nowrap"
               >
                <Printer className="w-4 h-4" /> Print Data
               </button>
             </div>
          </div>
        </section>
      </main>

      {/* Global Status Bar */}
      <footer className="h-8 bg-slate-900 border-t border-slate-800 flex items-center px-8 justify-between shrink-0 print:hidden">
        <div className="flex items-center gap-4 text-[9px] text-slate-500 font-mono font-bold tracking-tight">
          <span className="flex items-center gap-2 uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> 
            CALCULATION ENGINE IDLE
          </span>
          <span className="text-slate-800">|</span>
          <span className="uppercase text-slate-600">Region: Int. Metrology</span>
        </div>
        <div className="text-[9px] text-slate-600 font-bold uppercase tracking-widest font-mono">
          © 2026 PRECISION ALGORITHMS INC // V1.4
        </div>
      </footer>

      {/* Print Warning Modal */}
      {showPrintWarning && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-lg max-w-sm w-full shadow-2xl flex flex-col gap-4 relative">
            <button 
              onClick={() => setShowPrintWarning(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-300"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="w-12 h-12 bg-blue-900/30 rounded-full flex items-center justify-center text-blue-400 mb-2">
              <Printer className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white tracking-tight">인쇄 기능 제약 안내</h3>
            <p className="text-sm text-slate-400 leading-relaxed font-sans">
              현재 접속하신 미리보기 환경(iFrame)에서는 보안상의 이유로 브라우저의 직접 인쇄 기능이 차단되어 있습니다.
            </p>
            <p className="text-sm text-slate-300 mt-2 bg-slate-800 p-3 rounded font-sans leading-relaxed">
              우측 상단의 <span className="font-bold text-white">"Open in new tab"</span> (새 창에서 열기) 아이콘을 클릭하여 앱을 독립된 창으로 띄우신 후 다시 시도해 주세요.
            </p>
            <div className="mt-4 flex justify-end">
              <button 
                onClick={() => setShowPrintWarning(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded text-sm font-medium transition-colors"
              >
                확인했습니다
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
