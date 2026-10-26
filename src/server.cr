require "./md_editor"

# Bootstrap the app: load config, open the DB, register routes.
MdEditor.configure
MdEditor.init_db
MdEditor::Routes.setup

# Site gate first (position 1 = right after Kemal's init handler, before the
# static file handler) so no file or route is reachable without a pass.
Kemal.config.add_handler(MdEditor::Guard.new, 1)
Kemal.config.add_handler(MdEditor::Gate.new, 2)

if MdEditor.config.dev_auto_login
  STDERR.puts "!" * 72
  STDERR.puts "!! server.dev_auto_login is ON: every visitor is signed in as the first"
  STDERR.puts "!! user, and the [access] gate/allowlist are disabled. DEV ONLY."
  STDERR.puts "!" * 72
end

Kemal.config.host_binding = MdEditor.config.host
Kemal.config.port = MdEditor.config.port

# Serve the built frontend (if present); see server.public_dir in config.
Kemal.config.public_folder = MdEditor.config.public_dir

# Kemal's static handler serves /assets/* before routes run, so cache policy
# for hashed bundles lives here. Vite emits content-hashed filenames: safe to
# cache forever. Everything else falls through to serve_spa, which marks
# index.html no-cache (see below) so rebuilds are picked up immediately.
static_headers do |env, file_path, file_stat|
  if file_path.includes?("/assets/")
    env.response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
  end
end

# Liveness for container HEALTHCHECK / systemd; bypasses the gate, leaks nothing.
get "/healthz" do |env|
  env.response.content_type = "text/plain"
  "ok"
end

# SPA fallback: any non-API, non-file path → index.html.
get "/" do |env|
  serve_spa(env, "")
end

get "/*path" do |env|
  serve_spa(env, env.params.url["path"]? || "")
end

private def serve_spa(env, path : String)
  public_dir = MdEditor.config.public_dir
  # Let API misses fall through to the JSON 404 handler.
  raise MdEditor::ApiError.new(404, "not found") if path.starts_with?("api/")

  candidate = File.join(public_dir, path)
  index = File.join(public_dir, "index.html")

  # No frontend built yet — say so clearly instead of a 500.
  unless File.file?(index)
    env.response.status_code = 200
    env.response.headers["Content-Type"] = "text/plain"
    return "md_editor API is running. No frontend bundle found at ./public."
  end

  if File.file?(candidate)
    send_file env, candidate
  else
    # no-cache = store but always revalidate (Etag/Last-Modified still apply).
    # Without this, browsers heuristically cache index.html and keep booting a
    # stale bundle after a rebuild — the "my UI didn't change" bug.
    env.response.headers["Cache-Control"] = "no-cache"
    send_file env, index
  end
end

Kemal.run
