require "./spec_helper"
require "file_utils"
require "../src/md_editor" # kemal + modules; NOT server.cr, which would Kemal.run

# Boot the real route stack ONCE for every route spec (gate/guard are only
# added in server.cr, so they're absent here). Crystal requires dedupe by
# resolved path, so requiring this from several *_spec.cr files is safe;
# each spec seeds its own users/repos through MdEditor.db inside describes.
SPEC_ROOT = "/tmp/md_editor_web_spec"
FileUtils.rm_rf(SPEC_ROOT)
Dir.mkdir_p(SPEC_ROOT)
ENV["MD_EDITOR_CONFIG"] = File.join(SPEC_ROOT, "config.toml")
File.write(ENV["MD_EDITOR_CONFIG"], <<-TOML)
  [server]
  host = "127.0.0.1"
  port = 0
  secret_key = "#{Random::Secure.hex(32)}"
  data_dir = "#{SPEC_ROOT}/data"
  public_origin = "http://127.0.0.1:0"
  TOML

MdEditor.configure
MdEditor.init_db
MdEditor::Routes.setup

Kemal.config.logging = false
Kemal.config.setup
WEB_SERVER = HTTP::Server.new(Kemal.config.handlers)
WEB_PORT   = WEB_SERVER.bind_tcp("127.0.0.1", 0).port
spawn { WEB_SERVER.listen }
# No explicit teardown: at_exit handlers run LIFO and crystal spec's runner is
# itself one (registered before this file loads), so an at_exit close would run
# BEFORE the examples. Process exit reaps the listener.

def web_base : String
  "http://127.0.0.1:#{WEB_PORT}"
end
