require "http/server/handler"
require "html"

module MdEditor
  # Site-wide shared-password gate ([access] password). Runs before the
  # static/file and route handlers, so nothing — bundle, index.html or API —
  # is served without a pass. Off entirely when no password is configured or
  # dev_auto_login is on.
  class Gate
    include HTTP::Handler

    PATH = "/gate"

    # failed attempts per client address: 10 per 15 min, then locked out
    MAX_FAILS = 10
    WINDOW    = 15.minutes
    @fails = {} of String => {Int32, Time}
    @lock = Mutex.new

    def call(context : HTTP::Server::Context)
      cfg = MdEditor.config
      return call_next(context) unless cfg.gate_enabled?
      password = cfg.gate_password.not_nil!
      req = context.request
      return call_next(context) if req.path == "/healthz"

      if req.path == PATH
        return req.method == "POST" ? submit(context, password) : page(context, nil, safe_next(req.query_params["next"]?))
      end

      pass = req.cookies[Security::GATE_COOKIE]?.try(&.value)
      return call_next(context) if pass && Security.verify_gate(pass, password)

      if req.path.starts_with?("/api/")
        context.response.status_code = 401
        context.response.content_type = "application/json"
        context.response.print %({"error":"gate"})
      else
        context.response.status_code = 303
        context.response.headers["Location"] = "#{PATH}?next=#{URI.encode_www_form(req.resource)}"
      end
    end

    private def submit(context, password : String)
      body = context.request.body.try(&.gets_to_end) || ""
      form = URI::Params.parse(body)
      nxt = safe_next(form["next"]?)
      who = client(context)
      if locked?(who)
        return page(context, "too many attempts — try again in 15 minutes", nxt, 429)
      end
      if Security.password_matches?(form["password"]? || "", password)
        @lock.synchronize { @fails.delete(who) }
        secure = MdEditor.config.public_origin.starts_with?("https://")
        context.response.cookies << HTTP::Cookie.new(Security::GATE_COOKIE, Security.sign_gate(password),
          http_only: true, secure: secure, samesite: :lax, max_age: Security::GATE_TTL, path: "/")
        context.response.status_code = 303
        context.response.headers["Location"] = nxt
      else
        record_fail(who)
        sleep 0.6.seconds # blunt brute force
        page(context, "wrong password", nxt, 401)
      end
    end

    private def client(context) : String
      case addr = context.request.remote_address
      when Socket::IPAddress then addr.address
      else                        "?"
      end
    end

    private def locked?(who : String) : Bool
      @lock.synchronize do
        n, since = @fails[who]? || return false
        if Time.utc - since > WINDOW
          @fails.delete(who)
          false
        else
          n >= MAX_FAILS
        end
      end
    end

    private def record_fail(who : String) : Nil
      @lock.synchronize do
        n, since = @fails[who]? || {0, Time.utc}
        since = Time.utc if Time.utc - since > WINDOW
        @fails[who] = {n + 1, since}
        @fails.shift if @fails.size > 10_000 # bound memory
      end
    end

    # only same-site absolute paths; never "//host" or a scheme
    private def safe_next(n : String?) : String
      return "/" unless n && n.starts_with?('/') && !n.starts_with?("//") && !n.includes?('\\')
      n
    end

    private def page(context, error : String?, nxt : String, status = 200)
      context.response.status_code = status
      context.response.content_type = "text/html; charset=utf-8"
      context.response.headers["Cache-Control"] = "no-store"
      context.response.print <<-HTML
        <!doctype html><html lang="en"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark">
        <title>md_editor</title><style>
        *{box-sizing:border-box}html,body{margin:0;background:#000;color:#fff;font:13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
        main{min-height:100vh;display:grid;place-items:center;padding:24px 16px}
        form{width:100%;max-width:320px;display:flex;flex-direction:column;gap:12px}
        h1{font-size:20px;font-weight:600;margin:0 0 4px;display:flex;align-items:center;gap:8px}
        h1 i{width:10px;height:10px;background:#7dd3fc;display:inline-block}
        p{margin:0;color:#8a8a8a;font:11px ui-monospace,"SF Mono",Menlo,monospace}
        input{height:40px;padding:0 12px;background:#0a0a0a;border:1px solid #262626;color:#fff;font:16px system-ui,sans-serif;border-radius:0;outline:none}
        input:focus{border-color:#7dd3fc}
        button{height:40px;border:0;border-radius:0;background:#fff;color:#000;font:600 13px system-ui,sans-serif;cursor:pointer}
        .err{color:#f87171}
        </style></head><body><main><form method="post" action="#{PATH}">
        <h1><i></i>md_editor</h1><p>this site is private — enter the access password</p>
        <input type="hidden" name="next" value="#{HTML.escape(nxt)}">
        <input type="password" name="password" placeholder="password" autocomplete="current-password" autofocus required>
        #{error ? %(<p class="err">#{HTML.escape(error)}</p>) : ""}
        <button type="submit">continue</button>
        </form></main></body></html>
        HTML
    end
  end
end
