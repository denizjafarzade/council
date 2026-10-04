// Backend calls: role/market library, saved councils, headlines and the user's portfolio.

async function call(method, url, body, contentType = 'application/json') {
  const raw = typeof body === 'string'
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': raw ? contentType : 'application/json' } : undefined,
    body: body ? (raw ? body : JSON.stringify(body)) : undefined,
  })
  if (r.status === 204) return null
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    // FastAPI puts a string in detail for our errors and a list for schema errors.
    const detail = Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join('; ') : data.detail
    throw new Error(detail || `HTTP ${r.status}`)
  }
  return data
}

export const api = {
  library: () => call('GET', '/library'),
  addRole: (role) => call('POST', '/library/roles', role),
  deleteRole: (id) => call('DELETE', `/library/roles/${id}`),
  addMarket: (market) => call('POST', '/library/markets', market),
  addSector: (sector) => call('POST', '/library/sectors', sector),
  deleteSector: (id) => call('DELETE', `/library/sectors/${id}`),
  deleteMarket: (code) => call('DELETE', `/library/markets/${code}`),
  councils: () => call('GET', '/councils'),
  saveCouncil: (council) => call('PUT', '/councils', council),
  deleteCouncil: (id) => call('DELETE', `/councils/${id}`),
  topNews: (markets) => call('GET', `/news/top${markets?.length ? `?markets=${markets.join(',')}` : ''}`),
  refreshNews: (markets) => call('POST', '/news/refresh', { markets }),
  portfolio: () => call('GET', '/portfolio'),
  uploadPortfolio: (csvText, label) => call('POST', `/portfolio?label=${encodeURIComponent(label)}`, csvText, 'text/csv'),
  samplePortfolio: () => call('POST', '/portfolio/sample'),
  clearPortfolio: () => call('DELETE', '/portfolio'),
}
