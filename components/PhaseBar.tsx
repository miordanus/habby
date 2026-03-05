"use client"

import type { Phase } from "@/types/database"
import { getPhaseLabel, getPhaseEmoji } from "@/lib/phaseUtils"

interface Props {
  phase: Phase
}

const PHASE_COLORS: Record<Phase, string> = {
  morning: "border-yellow-400 text-yellow-400",
  day:     "border-blue-400 text-blue-400",
  evening: "border-purple-500 text-purple-400",
}

export default function PhaseBar({ phase }: Props) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${PHASE_COLORS[phase]} bg-transparent w-fit`}>
      <span className="text-sm">{getPhaseEmoji(phase)}</span>
      <span className="text-xs font-mono font-bold tracking-widest uppercase">{getPhaseLabel(phase)}</span>
    </div>
  )
}
