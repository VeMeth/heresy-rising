export function healthHandler(req, res) {
  const store = req.app.get('sessionStore');
  res.set('Cache-Control', 'no-store').json({
    ok: true,
    sessions: store ? store.count() : 0,
    uptime: (process.uptime() * 1000) | 0
  });
}