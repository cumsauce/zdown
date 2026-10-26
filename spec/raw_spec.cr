require "./web_helper"
require "file_utils"

PNG_BYTES = Bytes[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0xff, 0x7f]
RAW_ROOT = "/tmp/md_editor_raw_spec"

private def raw_req(repo_id : Int64, path_q : String, session : Int64? = nil) : HTTP::Client::Response
  headers = HTTP::Headers.new
  headers["Cookie"] = "md_editor_session=#{MdEditor::Security.sign_session(session)}" if session
  HTTP::Client.get("#{web_base}/api/repos/#{repo_id}/raw?path=#{path_q}", headers: headers)
end

# GET /api/repos/:repo_id/raw serves repo blobs so the preview can show
# in-repo images: binary-safe, owner-scoped, images only. Without it a
# `![](pic.png)` in a post 404s against the SPA fallback. Seeding happens
# once at load (examples are read-only); only the repos-dir override needs
# re-applying per run, because git_spec's before_all points it elsewhere.
describe "GET /api/repos/:repo_id/raw" do
  FileUtils.rm_rf(RAW_ROOT)
  Dir.mkdir_p("#{RAW_ROOT}/repos")
  src = "#{RAW_ROOT}/src"
  Process.run("git", ["init", "-q", "-b", "main", src])
  Dir.mkdir_p("#{src}/content/posts")
  Dir.mkdir_p("#{src}/static")
  File.write("#{src}/content/posts/hi.md", "+++\ntitle = \"Hi\"\n+++\n\n![](pic.png)\n")
  File.write("#{src}/content/posts/pic.png", PNG_BYTES)
  File.write("#{src}/static/logo.png", PNG_BYTES)
  File.write("#{src}/notes.txt", "not an image\n")
  Process.run("git", ["add", "."], chdir: src)
  Process.run("git", ["commit", "-q", "-m", "init"], chdir: src,
    env: {"GIT_AUTHOR_NAME" => "t", "GIT_AUTHOR_EMAIL" => "t@t",
          "GIT_COMMITTER_NAME" => "t", "GIT_COMMITTER_EMAIL" => "t@t"})

  uid = MdEditor.db.scalar(
    "INSERT INTO users (provider, provider_uid, login, name, avatar_url, access_token_enc, created_at) " \
    "VALUES ('github', 'raw-spec', 'specuser', NULL, NULL, 'x', 0) RETURNING id").as(Int64)
  repo_id = MdEditor.db.scalar(
    "INSERT INTO repos (user_id, provider, full_name, default_branch, created_at) " \
    "VALUES (?, 'local', 'specsite', 'main', 0) RETURNING id", uid).as(Int64)
  other_uid = MdEditor.db.scalar(
    "INSERT INTO users (provider, provider_uid, login, name, avatar_url, access_token_enc, created_at) " \
    "VALUES ('github', 'raw-spec-2', 'otheruser', NULL, NULL, 'x', 0) RETURNING id").as(Int64)

  # The mirror dir must be named for the row's real id (mirror_path uses it).
  Process.run("git", ["clone", "-q", "--mirror", src, "#{RAW_ROOT}/repos/#{repo_id}.git"])

  before_all { MdEditor::Git.override_repos_dir_for_tests("#{RAW_ROOT}/repos") }
  after_all { FileUtils.rm_rf(RAW_ROOT) }

  it "refuses anonymous requests" do
    raw_req(repo_id, "static/logo.png").status_code.should eq(401)
  end

  it "serves a binary blob at the working ref with its image type" do
    resp = raw_req(repo_id, "content/posts/pic.png", uid)
    resp.status_code.should eq(200)
    resp.headers["Content-Type"]?.should eq("image/png")
    resp.body.should eq(String.new(PNG_BYTES))
    resp.headers["Etag"]?.should_not be_nil
  end

  it "revalidates to 304 on If-None-Match" do
    etag = raw_req(repo_id, "static/logo.png", uid).headers["Etag"]
    resp = HTTP::Client.get("#{web_base}/api/repos/#{repo_id}/raw?path=static/logo.png",
      headers: HTTP::Headers{"Cookie" => "md_editor_session=#{MdEditor::Security.sign_session(uid)}",
                             "If-None-Match" => etag})
    resp.status_code.should eq(304)
  end

  it "serves only images" do
    raw_req(repo_id, "notes.txt", uid).status_code.should eq(415)
  end

  it "404s missing files" do
    raw_req(repo_id, "static/gone.png", uid).status_code.should eq(404)
  end

  it "refuses traversal paths" do
    raw_req(repo_id, "../etc/passwd", uid).status_code.should eq(400)
  end

  it "only serves the owner" do
    raw_req(repo_id, "static/logo.png", other_uid).status_code.should eq(404)
  end
end
