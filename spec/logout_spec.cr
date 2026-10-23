require "./spec_helper"
require "file_utils"
require "../src/md_editor" # kemal + modules; NOT server.cr, which would Kemal.run

# Regression: sign-out used env.response.cookies.delete, but the response
# cookie jar starts empty (request cookies are never copied into it), so the
# call was a silent no-op — no Set-Cookie header, browser kept its 30-day
# session. Boot the real route stack (gate/guard are only added in server.cr,
# so they're absent here) on an ephemeral port and pin the deletion contract.
SPEC_ROOT = "/tmp/md_editor_logout_spec"
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
server = HTTP::Server.new(Kemal.config.handlers)
address = server.bind_tcp("127.0.0.1", 0)
spawn { server.listen }
# No explicit teardown: at_exit handlers run LIFO and crystal spec's runner is
# itself one (registered before this file loads), so an at_exit close would run
# BEFORE the examples. Process exit reaps the listener.

describe "POST /api/auth/logout" do
  it "tells the browser to drop the session cookie" do
    resp = HTTP::Client.post("http://127.0.0.1:#{address.port}/api/auth/logout",
      headers: HTTP::Headers{"Cookie" => "md_editor_session=1.9999999999.abc"})
    resp.status_code.should eq(200)

    cookie = resp.cookies["md_editor_session"]?
    cookie.should_not be_nil
    # Max-Age=0 (RFC 6265 wins over Expires) plus a 1970 Expires for old agents:
    # either one alone makes the browser evict the cookie.
    cookie.not_nil!.max_age.should eq(Time::Span.zero)
    cookie.not_nil!.expires.not_nil!.year.should eq(1970)
    cookie.not_nil!.path.should eq("/")
    cookie.not_nil!.http_only.should be_true
  end
end
