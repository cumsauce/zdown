require "http/server/handler"
require "uri"

module MdEditor
  # First handler in the chain: security headers on every response, and a
  # cross-site request guard for state-changing calls. Session cookies are
  # SameSite=Lax already; this is the second wall (it also covers a browser
  # that ignores SameSite, and the `text/plain` form-POST trick that would
  # otherwise parse as JSON).
  class Guard
    include HTTP::Handler

    SAFE = {"GET", "HEAD", "OPTIONS"}

    # styletron / CodeMirror inject <style> tags → style-src needs inline.
    # Scripts are self-only: no inline JS, so `javascript:` links in a
    # rendered post can't run either.
    CSP = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ")

    def call(context : HTTP::Server::Context)
      h = context.response.headers
      h["Content-Security-Policy"] = CSP
      h["X-Content-Type-Options"] = "nosniff"
      h["X-Frame-Options"] = "DENY"
      h["Referrer-Policy"] = "same-origin"
      h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
      if MdEditor.config.public_origin.starts_with?("https://")
        h["Strict-Transport-Security"] = "max-age=31536000"
      end

      req = context.request
      if !SAFE.includes?(req.method) && cross_site?(req)
        context.response.status_code = 403
        context.response.content_type = "application/json"
        context.response.print %({"error":"cross-site request refused"})
        return
      end
      call_next(context)
    end

    private def cross_site?(req : HTTP::Request) : Bool
      if site = req.headers["Sec-Fetch-Site"]?
        return !(site == "same-origin" || site == "none")
      end
      origin = req.headers["Origin"]?
      return false if origin.nil? # non-browser clients (curl, scripts) send none
      return true if origin == "null"
      host = URI.parse(origin).host.try { |hh| "#{hh}#{URI.parse(origin).port.try { |p| ":#{p}" }}" }
      allowed = [req.headers["Host"]?, URI.parse(MdEditor.config.public_origin).try { |u| "#{u.host}#{u.port.try { |p| ":#{p}" }}" }]
      !allowed.includes?(host)
    rescue
      true
    end
  end
end
