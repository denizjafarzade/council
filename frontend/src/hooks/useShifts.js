import { useMemo } from 'react'
import { computeShifts } from '../lib/council'

/** Vote shifts: the Chair's computed list once the brief is in, else worked out from the votes so far. */
export function useShifts(state) {
  return useMemo(
    () => state.brief?.vote_shifts ?? computeShifts(state.votes.blind, state.votes.revote),
    [state.brief, state.votes],
  )
}
