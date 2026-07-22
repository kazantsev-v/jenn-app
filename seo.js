const INDEXABLE_PATHS = [
  { path: '/', priority: '1.0' },
  { path: '/products', priority: '0.9' },
  { path: '/docs', priority: '0.8' },
  { path: '/faq', priority: '0.7' },
  { path: '/faq/notion-setup', priority: '0.7' },
]

const PRIVATE_PATH_PREFIXES = ['/app', '/console', '/v1', '/health', '/stitch']

function publicOrigin(req) {
  const configuredUrl = process.env.SITE_URL || process.env.DOMAIN
  if (configuredUrl) {
    const normalized = String(configuredUrl).trim().replace(/\/+$/, '')
    return /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`
  }

  const forwardedProtocol = req.get('x-forwarded-proto')?.split(',')[0]?.trim()
  return `${forwardedProtocol || req.protocol}://${req.get('host')}`
}

function isPrivatePath(pathname) {
  return pathname.endsWith('.html') || PRIVATE_PATH_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function registerSeoRoutes(app) {
  const legacyPageRedirects = {
    '/index.html': '/',
    '/products.html': '/products',
    '/docs.html': '/docs',
    '/faq.html': '/faq',
    '/faq-notion.html': '/faq/notion-setup',
  }

  for (const [legacyPath, canonicalPath] of Object.entries(legacyPageRedirects)) {
    app.get(legacyPath, (req, res) => res.redirect(301, canonicalPath))
  }

  app.get('/robots.txt', (req, res) => {
    const origin = publicOrigin(req)
    res.type('text/plain').send([
      'User-agent: *',
      'Allow: /',
      'Disallow: /app',
      'Disallow: /console',
      'Disallow: /v1/',
      'Disallow: /health',
      'Disallow: /stitch/',
      '',
      `Sitemap: ${origin}/sitemap.xml`,
    ].join('\n'))
  })

  app.get('/sitemap.xml', (req, res) => {
    const origin = publicOrigin(req)
    const urls = INDEXABLE_PATHS.map(({ path, priority }) => [
      '  <url>',
      `    <loc>${origin}${path}</loc>`,
      `    <priority>${priority}</priority>`,
      '  </url>',
    ].join('\n')).join('\n')

    res.type('application/xml').send([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      urls,
      '</urlset>',
    ].join('\n'))
  })

  app.use((req, res, next) => {
    if (req.method !== 'GET') return next()

    if (isPrivatePath(req.path)) {
      res.set('X-Robots-Tag', 'noindex, nofollow')
      return next()
    }

    const indexedPath = INDEXABLE_PATHS.find(({ path }) => path === req.path)
    if (indexedPath) {
      res.set('X-Robots-Tag', 'index, follow')
      res.set('Link', `<${publicOrigin(req)}${indexedPath.path}>; rel="canonical"`)
    }

    next()
  })
}

module.exports = { registerSeoRoutes }
