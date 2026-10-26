require "./web_helper"

# Regression: sign-out used env.response.cookies.delete, but the response
# cookie jar starts empty (request cookies are never copied into it), so the
# call was a silent no-op — no Set-Cookie header, browser kept its 30-day
# session. The route stack is booted in web_helper.cr; pin the deletion
# contract.
describe "POST /api/auth/logout" do
  it "tells the browser to drop the session cookie" do
    resp = HTTP::Client.post("#{web_base}/api/auth/logout",
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
