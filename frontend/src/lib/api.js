// Backend calls for the council builder: role/market library and saved councils.

async function call(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
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
  deleteMarket: (code) => call('DELETE', `/library/markets/${code}`),
  councils: () => call('GET', '/councils'),
  saveCouncil: (council) => call('PUT', '/councils', council),
  deleteCouncil: (id) => call('DELETE', `/councils/${id}`),
}
