import { useMemo } from 'react';

export function useAuthHeaders(token: string): { Authorization: string } {
  return useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
}
